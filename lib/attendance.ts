import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { distanceMeters } from "@/lib/geo";
import { argentinaParts, isoForArgentinaLocal, minutesDifferenceFromSchedule, minutesFromHHMM } from "@/lib/time";
import { hashToken } from "@/lib/qr";
import { pinLookup } from "@/lib/auth";

type LocationInput = { lat: number; lng: number; accuracy?: number | null };

export async function getOfficeSettings() {
  const sql = db();
  const rows = await sql`
    SELECT office_name, latitude, longitude, radius_meters,
           lateness_tolerance_minutes, auto_close_grace_minutes, qr_ttl_minutes
    FROM office_settings WHERE id = 1
  `;
  return rows[0] || null;
}

export async function validateQr(token: string) {
  const sql = db();
  const tokenHash = hashToken(token);
  const rows = await sql`
    SELECT id, expires_at
    FROM qr_tokens
    WHERE token_hash = ${tokenHash} AND expires_at > now()
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function validateLocation(location: LocationInput) {
  const settings = await getOfficeSettings();
  if (!settings || settings.latitude == null || settings.longitude == null) {
    return { ok: false as const, reason: "OFFICE_NOT_CONFIGURED", distance: null, settings };
  }
  const distance = distanceMeters(
    Number(location.lat),
    Number(location.lng),
    Number(settings.latitude),
    Number(settings.longitude)
  );
  const ok = distance <= Number(settings.radius_meters);
  return { ok, reason: ok ? null : "OUTSIDE_RADIUS", distance, settings };
}

export async function findEmployeeByPin(pin: string) {
  const sql = db();
  const lookup = await pinLookup(pin);
  const rows = await sql`
    SELECT id, last_name, first_name, dni, employment, pin_hash, force_pin_change, pin_changed_at, pin_change_source, temporary_pin_expires_at
    FROM employees
    WHERE active = TRUE AND pin_lookup = ${lookup} AND pin_hash IS NOT NULL
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.pin_hash) return null;
  if (row.temporary_pin_expires_at && new Date(row.temporary_pin_expires_at).getTime() < Date.now()) return null;
  return (await bcrypt.compare(pin, String(row.pin_hash))) ? row : null;
}

export async function todayEmployeeContext(employeeId: string): Promise<{
  date: string;
  weekday: number;
  schedule: Record<string, any> | null;
  leave: Record<string, any> | null;
  attendance: Record<string, any> | null;
  lastEvent: Record<string, any> | null;
}> {
  const sql = db();
  const p = argentinaParts();
  const scheduleRows = await sql`
    SELECT start_time::text AS start_time, end_time::text AS end_time
    FROM employee_schedules
    WHERE employee_id = ${employeeId} AND weekday = ${p.weekday}
    LIMIT 1
  `;
  const schedule = scheduleRows[0] || null;
  if (!schedule) return { date: p.date, weekday: p.weekday, schedule: null, leave: null, attendance: null, lastEvent: null };

  const leaveRows = await sql`
    SELECT id, leave_type, date_from::text, date_to::text, observation
    FROM leave_records
    WHERE employee_id = ${employeeId}
      AND active = TRUE
      AND ${p.date}::date BETWEEN date_from AND date_to
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const attendanceRows = await sql`
    SELECT id, work_date::text, scheduled_start::text, scheduled_end::text,
           entry_at, exit_at, late_minutes, early_minutes,
           compensation_minutes, pending_minutes, exit_type
    FROM attendance_days
    WHERE employee_id = ${employeeId} AND work_date = ${p.date}::date
    LIMIT 1
  `;
  const attendance = attendanceRows[0] || null;
  let lastEvent: Record<string, any> | null = null;
  if (attendance?.id) {
    const events = await sql`
      SELECT id,event_type,occurred_at
      FROM attendance_events
      WHERE attendance_day_id=${attendance.id}
        AND event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT')
      ORDER BY occurred_at DESC,id DESC LIMIT 1
    `;
    lastEvent = events[0] || null;
  }
  return { date: p.date, weekday: p.weekday, schedule, leave: leaveRows[0] || null, attendance, lastEvent };
}

export async function registerEntry(params: { employeeId: string; location: LocationInput; distance: number }) {
  const sql = db();
  const context = await todayEmployeeContext(params.employeeId);
  if (!context.schedule) throw new Error("NO_SCHEDULE");
  if (context.leave) throw new Error("ON_LEAVE");
  if (context.attendance?.entry_at) throw new Error("ENTRY_EXISTS");

  const settings = await getOfficeSettings();
  const tolerance = Number(settings?.lateness_tolerance_minutes || 15);
  const rawLate = Math.max(0, minutesDifferenceFromSchedule(String(context.schedule.start_time).slice(0, 5)));
  // Hasta la tolerancia no hay atraso. Si se supera, se computa el total desde la hora prevista.
  const lateMinutes = rawLate > tolerance ? rawLate : 0;

  const rows = await sql`
    INSERT INTO attendance_days(
      employee_id, work_date, scheduled_start, scheduled_end,
      entry_at, entry_latitude, entry_longitude, entry_accuracy, entry_distance_meters,
      late_minutes, pending_minutes
    ) VALUES (
      ${params.employeeId}, ${context.date}::date,
      ${String(context.schedule.start_time).slice(0, 5)}::time,
      ${String(context.schedule.end_time).slice(0, 5)}::time,
      now(), ${params.location.lat}, ${params.location.lng}, ${params.location.accuracy || null}, ${params.distance},
      ${lateMinutes}, ${lateMinutes}
    )
    ON CONFLICT (employee_id, work_date) DO NOTHING
    RETURNING id, entry_at, late_minutes, scheduled_start::text, scheduled_end::text
  `;
  if (!rows[0]) throw new Error("ENTRY_EXISTS");
  const day = rows[0];
  await sql`
    INSERT INTO attendance_events(attendance_day_id, employee_id, event_type, latitude, longitude, accuracy, distance_meters)
    VALUES (${day.id}, ${params.employeeId}, 'ENTRY', ${params.location.lat}, ${params.location.lng}, ${params.location.accuracy || null}, ${params.distance})
  `;
  return day;
}

export async function registerExit(params: { employeeId: string; location: LocationInput; distance: number }) {
  const sql = db();
  const context = await todayEmployeeContext(params.employeeId);
  const current = context.attendance;
  if (!current?.entry_at) throw new Error("NO_ENTRY");
  if (!context.lastEvent || !['ENTRY','REENTRY'].includes(String(context.lastEvent.event_type))) throw new Error("EXIT_EXISTS");

  const scheduledEnd = String(current.scheduled_end).slice(0, 5);
  const diffAfterEnd = minutesDifferenceFromSchedule(scheduledEnd);
  const afterMinutes = Math.max(0, diffAfterEnd);
  const earlyMinutes = Math.max(0, -diffAfterEnd);
  const lateMinutes = Number(current.late_minutes || 0);
  const compensation = Math.min(lateMinutes, afterMinutes);
  const pending = Math.max(0, lateMinutes - compensation) + earlyMinutes;

  const rows = await sql`
    UPDATE attendance_days
    SET exit_at = now(),
        exit_latitude = ${params.location.lat},
        exit_longitude = ${params.location.lng},
        exit_accuracy = ${params.location.accuracy || null},
        exit_distance_meters = ${params.distance},
        early_minutes = ${earlyMinutes},
        compensation_minutes = ${compensation},
        pending_minutes = ${pending},
        exit_type = 'EMPLOYEE',
        updated_at = now()
    WHERE id = ${current.id}
    RETURNING id, entry_at, exit_at, late_minutes, early_minutes, compensation_minutes, pending_minutes, exit_type
  `;
  const day = rows[0];
  const ev = await sql`
    INSERT INTO attendance_events(attendance_day_id, employee_id, event_type, latitude, longitude, accuracy, distance_meters)
    VALUES (${day.id}, ${params.employeeId}, 'EXIT', ${params.location.lat}, ${params.location.lng}, ${params.location.accuracy || null}, ${params.distance})
    RETURNING id,occurred_at
  `;
  await sql`
    INSERT INTO attendance_intervals(attendance_day_id,employee_id,exit_event_id,exited_at)
    VALUES (${day.id},${params.employeeId},${ev[0].id},${ev[0].occurred_at})
  `;
  return day;
}

export async function registerReentry(params: { employeeId: string; location: LocationInput; distance: number }) {
  const sql = db();
  const context = await todayEmployeeContext(params.employeeId);
  const current = context.attendance;
  if (!current?.entry_at) throw new Error("NO_ENTRY");
  if (!context.lastEvent || String(context.lastEvent.event_type)!=='EXIT') throw new Error("REENTRY_NOT_ALLOWED");
  const open=(await sql`
    SELECT id FROM attendance_intervals
    WHERE attendance_day_id=${current.id} AND reentered_at IS NULL
    ORDER BY exited_at DESC LIMIT 1
  `)[0];
  if(!open) throw new Error("REENTRY_NOT_ALLOWED");
  const ev=await sql`
    INSERT INTO attendance_events(attendance_day_id, employee_id, event_type, latitude, longitude, accuracy, distance_meters)
    VALUES (${current.id}, ${params.employeeId}, 'REENTRY', ${params.location.lat}, ${params.location.lng}, ${params.location.accuracy || null}, ${params.distance})
    RETURNING id,occurred_at
  `;
  await sql`
    UPDATE attendance_intervals
    SET reentry_event_id=${ev[0].id},reentered_at=${ev[0].occurred_at},updated_at=now()
    WHERE id=${open.id}
  `;
  // La jornada vuelve a quedar abierta. La próxima salida será la última salida conocida
  // hasta que exista otro reingreso. El intervalo cerrado queda pendiente de clasificación administrativa.
  await sql`
    UPDATE attendance_days
    SET exit_at=NULL,exit_latitude=NULL,exit_longitude=NULL,exit_accuracy=NULL,exit_distance_meters=NULL,
        early_minutes=0,compensation_minutes=0,pending_minutes=late_minutes,exit_type=NULL,updated_at=now()
    WHERE id=${current.id}
  `;
  return {id:current.id,reentry_at:ev[0].occurred_at,late_minutes:Number(current.late_minutes||0)};
}

export async function autoCloseEligibleDays() {
  const sql = db();
  const settings = await getOfficeSettings();
  const grace = Number(settings?.auto_close_grace_minutes || 60);
  const nowParts = argentinaParts();
  const rows = await sql`
    SELECT id, employee_id, work_date::text, scheduled_end::text, late_minutes, entry_at
    FROM attendance_days
    WHERE entry_at IS NOT NULL AND exit_at IS NULL AND work_date <= ${nowParts.date}::date
  `;
  let closed = 0;
  for (const row of rows) {
    const last=(await sql`SELECT event_type FROM attendance_events WHERE attendance_day_id=${row.id} AND event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT') ORDER BY occurred_at DESC,id DESC LIMIT 1`)[0];
    // Si el último movimiento ya fue una salida, la jornada está cerrada por el propio agente.
    if(last?.event_type==='EXIT'||last?.event_type==='AUTO_EXIT') continue;
    const workDate = String(row.work_date).slice(0, 10);
    const end = String(row.scheduled_end).slice(0, 5);
    const dueMinutes = minutesFromHHMM(end) + Number(row.late_minutes || 0) + grace;
    const isPastDate = workDate < nowParts.date;
    const dueToday = workDate === nowParts.date && nowParts.hour * 60 + nowParts.minute >= dueMinutes;
    if (!isPastDate && !dueToday) continue;

    const theoreticalExitIso = isoForArgentinaLocal(workDate, end);
    const updated = await sql`
      UPDATE attendance_days
      SET exit_at = ${theoreticalExitIso}::timestamptz,
          early_minutes = 0,
          compensation_minutes = 0,
          pending_minutes = late_minutes,
          exit_type = 'AUTO',
          auto_close_processed_at = now(),
          updated_at = now()
      WHERE id = ${row.id} AND exit_at IS NULL
      RETURNING id
    `;
    if (updated[0]) {
      closed += 1;
      await sql`
        INSERT INTO attendance_events(attendance_day_id, employee_id, event_type, occurred_at, metadata)
        VALUES (${row.id}, ${row.employee_id}, 'AUTO_EXIT', ${theoreticalExitIso}::timestamptz, ${JSON.stringify({
          theoreticalExit: theoreticalExitIso,
          graceMinutes: grace,
          lateMinutes: Number(row.late_minutes || 0),
        })}::jsonb)
      `;
    }
  }
  return closed;
}
