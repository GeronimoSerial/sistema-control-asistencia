/**
 * Servicio de asistencia sobre la base de un nivel.
 *
 * Reemplaza a `lib/attendance.ts` del sistema anterior, con tres diferencias de fondo:
 *
 * 1. **La zona horaria viene del nivel**, no de una constante. Nada de concatenar `-03:00`.
 * 2. **Los eventos son la única fuente de verdad.** `attendance_days` es una proyección que se
 *    recalcula siempre con la misma función, `recomputeDay()`. En el sistema anterior el cálculo
 *    de tardanza estaba escrito tres veces —en el registro de entrada, en el recálculo del panel
 *    y en la marcación manual— y una de las copias ni siquiera leía la configuración.
 * 3. **La política es un dato.** Tolerancia, compensación, cierre automático y secuencia de
 *    movimientos salen de `attendance_policies`.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  zonedParts,
  zonedDateTimeToUtc,
  minutesFromHHMM,
} from "@/core/platform/time";
import { distanceMeters } from "@/core/platform/geo";
import {
  autoCloseDueMinute,
  computeClosure,
  computeLateness,
  type AttendancePolicy,
} from "@/core/attendance/policy";
import { hashToken, newToken, lookupKey, verifySecret, hashSecret } from "@/core/platform/secrets";
import { getSetting } from "@/core/config/store";

type Db = DatabaseSync;

export type LevelContext = {
  db: Db;
  /** Zona horaria del nivel: define la fecha de la jornada y los horarios. */
  timeZone: string;
  policy: AttendancePolicy;
  /** Secreto del servidor, para derivar índices de búsqueda de PIN. */
  secret: string;
};

export type Coordinates = { lat: number; lng: number; accuracy?: number | null };

/** Error de negocio con un código estable, para que la interfaz elija el mensaje. */
export class MarkError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "MarkError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * Tiempo local del nivel
 * ------------------------------------------------------------------ */

function localDate(ctx: LevelContext, at: Date): string {
  return zonedParts(ctx.timeZone, at).date;
}

function localWeekday(ctx: LevelContext, at: Date): number {
  return zonedParts(ctx.timeZone, at).weekday;
}

function localMinutes(ctx: LevelContext, iso: string | Date): number {
  const parts = zonedParts(ctx.timeZone, typeof iso === "string" ? new Date(iso) : iso);
  return parts.hour * 60 + parts.minute;
}

/* ------------------------------------------------------------------ *
 * QR rotativo
 * ------------------------------------------------------------------ */

export function issueQrToken(
  ctx: LevelContext,
  locationId: string,
  ttlMinutes: number,
  at: Date = new Date()
): { token: string; expiresAt: string } {
  const token = newToken();
  const expiresAt = new Date(at.getTime() + ttlMinutes * 60_000).toISOString();
  ctx.db
    .prepare(
      `INSERT INTO qr_tokens (location_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)`
    )
    .run(locationId, hashToken(token), at.toISOString(), expiresAt);
  return { token, expiresAt };
}

export function validateQrToken(ctx: LevelContext, token: string, at: Date = new Date()): boolean {
  const row = ctx.db
    .prepare(`SELECT id, expires_at FROM qr_tokens WHERE token_hash = ?`)
    .get(hashToken(token)) as unknown as { id: number; expires_at: string } | undefined;
  // Las marcas se guardan en ISO-8601 UTC, que ordena igual como texto que como instante.
  if (!row || row.expires_at <= at.toISOString()) return false;
  ctx.db.prepare(`UPDATE qr_tokens SET used_count = used_count + 1 WHERE id = ?`).run(row.id);
  return true;
}

/** Borra los tokens vencidos. Conviene llamarlo junto con la emisión de uno nuevo. */
export function purgeExpiredTokens(ctx: LevelContext, at: Date = new Date()): void {
  ctx.db.prepare(`DELETE FROM qr_tokens WHERE expires_at <= ?`).run(at.toISOString());
}

/* ------------------------------------------------------------------ *
 * PIN
 * ------------------------------------------------------------------ */

export type Person = {
  id: string;
  last_name: string;
  first_name: string;
  national_id: string;
  active: number;
};

export async function setPin(
  ctx: LevelContext,
  personId: string,
  pin: string,
  options: { forceChange?: boolean; expiresAt?: string | null; source?: string } = {}
): Promise<void> {
  const hash = await hashSecret(pin);
  const lookup = lookupKey(ctx.secret, "person-pin", pin);
  ctx.db
    .prepare(
      `INSERT INTO credentials (person_id, pin_hash, pin_lookup, force_change, changed_at, change_source, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET
         pin_hash = excluded.pin_hash, pin_lookup = excluded.pin_lookup,
         force_change = excluded.force_change, changed_at = excluded.changed_at,
         change_source = excluded.change_source, expires_at = excluded.expires_at,
         reset_count = reset_count + 1`
    )
    .run(
      personId, hash, lookup, options.forceChange ? 1 : 0,
      new Date().toISOString(), options.source ?? "ADMIN", options.expiresAt ?? null
    );
}

export async function findPersonByPin(
  ctx: LevelContext,
  pin: string,
  at: Date = new Date()
): Promise<Person | null> {
  const lookup = lookupKey(ctx.secret, "person-pin", pin);
  const row = ctx.db
    .prepare(
      `SELECT p.id, p.last_name, p.first_name, p.national_id, p.active,
              c.pin_hash, c.expires_at
       FROM credentials c
       JOIN people p ON p.id = c.person_id
       WHERE c.pin_lookup = ? AND p.active = 1
       LIMIT 1`
    )
    .get(lookup) as unknown as (Person & { pin_hash: string; expires_at: string | null }) | undefined;

  if (!row?.pin_hash) return null;
  if (row.expires_at && row.expires_at <= at.toISOString()) return null;
  // El índice de búsqueda no alcanza como prueba: se verifica el hash igual.
  if (!(await verifySecret(pin, row.pin_hash))) return null;

  return {
    id: row.id,
    last_name: row.last_name,
    first_name: row.first_name,
    national_id: row.national_id,
    active: row.active,
  };
}

/* ------------------------------------------------------------------ *
 * Dispositivo
 *
 * Regla: un dispositivo activo por persona, y un dispositivo no puede estar activo para dos
 * personas. Alcanza para impedir que alguien marque por otro.
 * ------------------------------------------------------------------ */

export type DeviceCheck =
  | { ok: true; boundNow: boolean }
  | { ok: false; reason: "DEVICE_USED_BY_OTHER" | "OTHER_DEVICE_AUTHORIZED" };

export function checkDevice(
  ctx: LevelContext,
  personId: string,
  deviceKey: string,
  options: { bindIfMissing?: boolean; userAgent?: string | null } = {}
): DeviceCheck {
  const hash = hashToken(`device:${deviceKey}`);
  const now = new Date().toISOString();

  const sameHash = ctx.db
    .prepare(`SELECT id, person_id, active FROM devices WHERE device_hash = ?`)
    .get(hash) as unknown as { id: string; person_id: string; active: number } | undefined;

  if (sameHash && sameHash.person_id !== personId && sameHash.active === 1) {
    return { ok: false, reason: "DEVICE_USED_BY_OTHER" };
  }

  const active = ctx.db
    .prepare(`SELECT id, device_hash FROM devices WHERE person_id = ? AND active = 1`)
    .get(personId) as unknown as { id: string; device_hash: string } | undefined;

  if (active && active.device_hash !== hash) {
    return { ok: false, reason: "OTHER_DEVICE_AUTHORIZED" };
  }

  if (active) {
    ctx.db.prepare(`UPDATE devices SET last_seen_at = ? WHERE id = ?`).run(now, active.id);
    return { ok: true, boundNow: false };
  }

  if (!options.bindIfMissing) return { ok: true, boundNow: false };

  if (sameHash) {
    ctx.db
      .prepare(
        `UPDATE devices SET person_id = ?, active = 1, revoked_at = NULL, last_seen_at = ? WHERE id = ?`
      )
      .run(personId, now, sameHash.id);
  } else {
    ctx.db
      .prepare(
        `INSERT INTO devices (id, person_id, device_hash, user_agent, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), personId, hash, options.userAgent ?? null, now, now);
  }
  return { ok: true, boundNow: true };
}

/* ------------------------------------------------------------------ *
 * Geocerca
 * ------------------------------------------------------------------ */

export type LocationCheck = {
  ok: boolean;
  distance: number | null;
  reason: "OUTSIDE_RADIUS" | "LOCATION_NOT_CONFIGURED" | null;
};

export function validateLocation(
  ctx: LevelContext,
  locationId: string,
  coordinates: Coordinates
): LocationCheck {
  const location = ctx.db
    .prepare(`SELECT id, latitude, longitude FROM locations WHERE id = ? AND active = 1`)
    .get(locationId) as unknown as
    | { id: string; latitude: number | null; longitude: number | null }
    | undefined;

  if (!location || location.latitude === null || location.longitude === null) {
    return { ok: false, distance: null, reason: "LOCATION_NOT_CONFIGURED" };
  }
  if (getSetting<boolean>(ctx.db, "attendance.require_geolocation", locationId) === false) {
    return { ok: true, distance: null, reason: null };
  }

  const radius = Number(getSetting<number>(ctx.db, "attendance.geofence_radius_meters", locationId) ?? 75);
  const distance = distanceMeters(
    coordinates.lat, coordinates.lng, location.latitude, location.longitude
  );
  return distance <= radius
    ? { ok: true, distance, reason: null }
    : { ok: false, distance, reason: "OUTSIDE_RADIUS" };
}

/* ------------------------------------------------------------------ *
 * Jornada
 * ------------------------------------------------------------------ */

type ScheduleRow = { start_time: string; end_time: string };
type DayRow = {
  id: number;
  person_id: string;
  work_date: string;
  scheduled_start: string;
  scheduled_end: string;
  entry_at: string | null;
  exit_at: string | null;
  late_minutes: number;
};
type EventRow = { id: number; event_type: string; occurred_at: string; metadata: string | null };

export function scheduleFor(ctx: LevelContext, personId: string, weekday: number): ScheduleRow | null {
  return (ctx.db
    .prepare(`SELECT start_time, end_time FROM person_schedules WHERE person_id = ? AND weekday = ?`)
    .get(personId, weekday) as unknown as ScheduleRow | undefined) ?? null;
}

export function openAbsenceFor(ctx: LevelContext, personId: string, date: string) {
  return (ctx.db
    .prepare(
      `SELECT r.id, t.code, t.name FROM absence_records r
       JOIN absence_types t ON t.id = r.absence_type_id
       WHERE r.person_id = ? AND r.active = 1 AND ? BETWEEN r.date_from AND r.date_to
       LIMIT 1`
    )
    .get(personId, date) as unknown as { id: string; code: string; name: string } | undefined) ?? null;
}

export function dayFor(ctx: LevelContext, personId: string, date: string): DayRow | null {
  return (ctx.db
    .prepare(`SELECT * FROM attendance_days WHERE person_id = ? AND work_date = ?`)
    .get(personId, date) as unknown as DayRow | undefined) ?? null;
}

/**
 * Movimientos vigentes de una jornada.
 *
 * Los anulados quedan en la tabla —son parte de la historia— pero no participan de ningún
 * cálculo. Como `recomputeDay()` parte de acá, alcanza con este filtro para que una anulación se
 * refleje en la tardanza, en la compensación y en el cierre sin tocar nada más.
 */
function movementsOf(ctx: LevelContext, dayId: number): EventRow[] {
  return ctx.db
    .prepare(
      `SELECT id, event_type, occurred_at, metadata FROM attendance_events
       WHERE attendance_day_id = ? AND event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT')
         AND voided_at IS NULL
       ORDER BY occurred_at, id`
    )
    .all(dayId) as unknown as EventRow[];
}

export function lastMovement(ctx: LevelContext, dayId: number): EventRow | null {
  const movements = movementsOf(ctx, dayId);
  return movements.length ? movements[movements.length - 1] : null;
}

export type NextAction = {
  /** Movimiento que corresponde ahora, o `null` si no hay ninguno posible. */
  action: "ENTRY" | "EXIT" | "REENTRY" | null;
  /** Por qué no hay acción posible, cuando `action` es `null`. */
  reason: "NO_SCHEDULE" | "ON_ABSENCE" | "DAY_CLOSED" | null;
  schedule: ScheduleRow | null;
  day: DayRow | null;
};

/**
 * Qué movimiento corresponde a una persona en este momento.
 *
 * Es lo que permite que la pantalla de marcación no tenga que decidir nada: muestra un solo
 * botón con lo que sigue. La secuencia y sus restricciones viven acá, no en la interfaz.
 */
export function nextAction(
  ctx: LevelContext,
  personId: string,
  at: Date = new Date()
): NextAction {
  const date = localDate(ctx, at);
  const schedule = scheduleFor(ctx, personId, localWeekday(ctx, at));
  if (!schedule) return { action: null, reason: "NO_SCHEDULE", schedule: null, day: null };
  if (openAbsenceFor(ctx, personId, date)) {
    return { action: null, reason: "ON_ABSENCE", schedule, day: null };
  }

  const day = dayFor(ctx, personId, date);
  if (!day?.entry_at) return { action: "ENTRY", reason: null, schedule, day };

  const last = lastMovement(ctx, day.id);
  if (!last) return { action: "ENTRY", reason: null, schedule, day };

  if (last.event_type === "ENTRY" || last.event_type === "REENTRY") {
    return { action: "EXIT", reason: null, schedule, day };
  }
  if (last.event_type === "EXIT" && ctx.policy.movementSequence === "MULTI") {
    return { action: "REENTRY", reason: null, schedule, day };
  }
  return { action: null, reason: "DAY_CLOSED", schedule, day };
}

/**
 * Recalcula la proyección de una jornada a partir de sus eventos.
 *
 * Éste es el **único** lugar donde se aplica la política de tardanza y de cierre. Cualquier
 * cambio —una marcación nueva, una corrección administrativa, el cierre automático— termina
 * llamando acá, así que no puede haber dos resultados distintos para los mismos eventos.
 */
export function recomputeDay(ctx: LevelContext, dayId: number): void {
  const day = ctx.db
    .prepare(`SELECT * FROM attendance_days WHERE id = ?`)
    .get(dayId) as unknown as DayRow | undefined;
  if (!day) return;

  const movements = movementsOf(ctx, dayId);
  const entry = movements.find((m) => m.event_type === "ENTRY");
  const now = new Date().toISOString();

  if (!entry) {
    ctx.db
      .prepare(
        `UPDATE attendance_days SET entry_at=NULL, exit_at=NULL, late_minutes=0, early_minutes=0,
         compensation_minutes=0, pending_minutes=0, exit_type=NULL, updated_at=? WHERE id=?`
      )
      .run(now, dayId);
    return;
  }

  const startMinutes = minutesFromHHMM(day.scheduled_start);
  const endMinutes = minutesFromHHMM(day.scheduled_end);
  const lateMinutes = computeLateness(
    ctx.policy,
    localMinutes(ctx, entry.occurred_at) - startMinutes
  );

  const last = movements[movements.length - 1];
  const closed = last.event_type === "EXIT" || last.event_type === "AUTO_EXIT";

  if (!closed) {
    // La jornada sigue abierta: lo adeudado es, por ahora, el atraso.
    ctx.db
      .prepare(
        `UPDATE attendance_days SET entry_at=?, exit_at=NULL, late_minutes=?, early_minutes=0,
         compensation_minutes=0, pending_minutes=?, exit_type=NULL, updated_at=? WHERE id=?`
      )
      .run(entry.occurred_at, lateMinutes, lateMinutes, now, dayId);
    return;
  }

  const exitMinutes = localMinutes(ctx, last.occurred_at);
  const closure = computeClosure(ctx.policy, {
    lateMinutes,
    minutesAfterScheduledEnd: Math.max(0, exitMinutes - endMinutes),
    earlyExitMinutes: Math.max(0, endMinutes - exitMinutes),
  });

  const source = (() => {
    if (last.event_type === "AUTO_EXIT") return "AUTO";
    try {
      const meta = last.metadata ? (JSON.parse(last.metadata) as { source?: string }) : null;
      return meta?.source === "ADMIN" ? "ADMIN" : "EMPLOYEE";
    } catch {
      return "EMPLOYEE";
    }
  })();

  ctx.db
    .prepare(
      `UPDATE attendance_days SET entry_at=?, exit_at=?, late_minutes=?, early_minutes=?,
       compensation_minutes=?, pending_minutes=?, exit_type=?, updated_at=? WHERE id=?`
    )
    .run(
      entry.occurred_at, last.occurred_at, closure.lateMinutes, closure.earlyMinutes,
      closure.compensationMinutes, closure.pendingMinutes, source, now, dayId
    );
}

/* ------------------------------------------------------------------ *
 * Marcaciones
 * ------------------------------------------------------------------ */

export type MarkInput = {
  personId: string;
  at?: Date;
  coordinates?: Coordinates | null;
  distanceMeters?: number | null;
  source?: "EMPLOYEE" | "ADMIN";
  note?: string | null;
};

function insertEvent(
  ctx: LevelContext,
  dayId: number,
  personId: string,
  eventType: string,
  at: Date,
  input: MarkInput
): number {
  const result = ctx.db
    .prepare(
      `INSERT INTO attendance_events
         (attendance_day_id, person_id, event_type, occurred_at, latitude, longitude, accuracy, distance_meters, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      dayId, personId, eventType, at.toISOString(),
      input.coordinates?.lat ?? null, input.coordinates?.lng ?? null,
      input.coordinates?.accuracy ?? null, input.distanceMeters ?? null,
      JSON.stringify({ source: input.source ?? "EMPLOYEE", note: input.note ?? null })
    );
  return Number(result.lastInsertRowid);
}

export function markEntry(ctx: LevelContext, input: MarkInput): DayRow {
  const at = input.at ?? new Date();
  const date = localDate(ctx, at);
  const schedule = scheduleFor(ctx, input.personId, localWeekday(ctx, at));
  if (!schedule) throw new MarkError("NO_SCHEDULE");
  if (openAbsenceFor(ctx, input.personId, date)) throw new MarkError("ON_ABSENCE");

  let day = dayFor(ctx, input.personId, date);
  if (day?.entry_at) throw new MarkError("ENTRY_EXISTS");

  if (!day) {
    const now = new Date().toISOString();
    ctx.db
      .prepare(
        `INSERT INTO attendance_days (person_id, work_date, scheduled_start, scheduled_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.personId, date, schedule.start_time, schedule.end_time, now, now);
    day = dayFor(ctx, input.personId, date)!;
  }

  insertEvent(ctx, day.id, input.personId, "ENTRY", at, input);
  recomputeDay(ctx, day.id);
  return dayFor(ctx, input.personId, date)!;
}

export function markExit(ctx: LevelContext, input: MarkInput): DayRow {
  const at = input.at ?? new Date();
  const date = localDate(ctx, at);
  const day = dayFor(ctx, input.personId, date);
  if (!day?.entry_at) throw new MarkError("NO_ENTRY");

  const last = lastMovement(ctx, day.id);
  if (!last || !["ENTRY", "REENTRY"].includes(last.event_type)) {
    throw new MarkError("EXIT_NOT_ALLOWED");
  }

  const eventId = insertEvent(ctx, day.id, input.personId, "EXIT", at, input);

  // La salida abre un intervalo que queda pendiente de clasificación administrativa: sólo
  // se sabrá si computa como trabajado cuando alguien le asigne un motivo.
  if (ctx.policy.movementSequence === "MULTI") {
    const now = new Date().toISOString();
    ctx.db
      .prepare(
        `INSERT INTO attendance_intervals
           (attendance_day_id, person_id, exit_event_id, exited_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(day.id, input.personId, eventId, at.toISOString(), now, now);
  }

  recomputeDay(ctx, day.id);
  return dayFor(ctx, input.personId, date)!;
}

export function markReentry(ctx: LevelContext, input: MarkInput): DayRow {
  if (ctx.policy.movementSequence !== "MULTI") throw new MarkError("REENTRY_NOT_ALLOWED");
  const at = input.at ?? new Date();
  const date = localDate(ctx, at);
  const day = dayFor(ctx, input.personId, date);
  if (!day?.entry_at) throw new MarkError("NO_ENTRY");

  const last = lastMovement(ctx, day.id);
  if (!last || last.event_type !== "EXIT") throw new MarkError("REENTRY_NOT_ALLOWED");

  const open = ctx.db
    .prepare(
      `SELECT id FROM attendance_intervals
       WHERE attendance_day_id = ? AND reentered_at IS NULL AND voided_at IS NULL
       ORDER BY exited_at DESC LIMIT 1`
    )
    .get(day.id) as unknown as { id: number } | undefined;
  if (!open) throw new MarkError("REENTRY_NOT_ALLOWED");

  const eventId = insertEvent(ctx, day.id, input.personId, "REENTRY", at, input);
  ctx.db
    .prepare(
      `UPDATE attendance_intervals SET reentry_event_id = ?, reentered_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(eventId, at.toISOString(), new Date().toISOString(), open.id);

  recomputeDay(ctx, day.id);
  return dayFor(ctx, input.personId, date)!;
}

/**
 * Intervalos que esperan clasificación administrativa.
 *
 * Toda salida abre un intervalo, pero mientras no haya un reingreso no se sabe si la persona
 * volvió o si terminó su jornada. Sólo los intervalos **cerrados por un reingreso** son ausencias
 * intermedias reales, y son los únicos que corresponde clasificar: asignarles un motivo y definir
 * si computan como tiempo trabajado. Un intervalo abierto al final del día no es un caso
 * pendiente, es simplemente el fin de la jornada.
 */
export function pendingIntervals(ctx: LevelContext, date?: string) {
  const base = `SELECT i.id, i.person_id, i.exited_at, i.reentered_at, d.work_date
                FROM attendance_intervals i
                JOIN attendance_days d ON d.id = i.attendance_day_id
                WHERE i.reentered_at IS NOT NULL AND i.counts_as_work IS NULL AND i.voided_at IS NULL`;
  return (date
    ? ctx.db.prepare(`${base} AND d.work_date = ? ORDER BY i.exited_at`).all(date)
    : ctx.db.prepare(`${base} ORDER BY i.exited_at`).all()) as unknown as {
    id: number;
    person_id: string;
    exited_at: string;
    reentered_at: string;
    work_date: string;
  }[];
}

/** Clasifica un intervalo: motivo y si computa como tiempo trabajado. */
export function classifyInterval(
  ctx: LevelContext,
  intervalId: number,
  input: { reasonCode: string; countsAsWork: boolean; note?: string | null; actor: string }
): void {
  ctx.db
    .prepare(
      `UPDATE attendance_intervals
       SET reason_code = ?, counts_as_work = ?, admin_note = ?, classified_by = ?, classified_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.reasonCode, input.countsAsWork ? 1 : 0, input.note ?? null,
      input.actor, new Date().toISOString(), new Date().toISOString(), intervalId
    );
}

/* ------------------------------------------------------------------ *
 * Corrección de movimientos
 * ------------------------------------------------------------------ */

/**
 * ¿Es válida esta secuencia de movimientos?
 *
 * Marcar es un acto encadenado: se entra, se sale, se vuelve a entrar. Agregar movimientos respeta
 * la cadena porque cada marcación mira la anterior. Corregir puede romperla desde el medio —anular
 * la entrada dejando la salida, adelantar un reingreso por detrás de la salida que lo precede—, y
 * no hay ninguna marcación posterior que lo advierta.
 *
 * Por eso la regla se escribe una sola vez, acá, y tanto la corrección como la anulación la
 * consultan **sobre el resultado** antes de escribirlo: si la jornada que quedaría no es una
 * jornada posible, la operación no se hace. Es preferible obligar a deshacer en orden —primero el
 * último movimiento, después el anterior— que permitir dejar el día en un estado que `recomputeDay`
 * interpretaría de cualquier manera.
 */
export function sequenceProblem(
  movements: { event_type: string; occurred_at: string }[],
  policy: AttendancePolicy
): string | null {
  if (!movements.length) return null;

  const ordered = [...movements].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  if (ordered[0].event_type !== "ENTRY") return "MUST_START_WITH_ENTRY";

  const isIn = (type: string) => type === "ENTRY" || type === "REENTRY";
  for (let i = 0; i < ordered.length; i++) {
    const current = ordered[i];
    if (i > 0) {
      if (current.event_type === "ENTRY") return "DUPLICATE_ENTRY";
      if (isIn(current.event_type) === isIn(ordered[i - 1].event_type)) return "OUT_OF_ORDER";
      if (current.occurred_at === ordered[i - 1].occurred_at) return "SAME_INSTANT";
    }
    if (current.event_type === "REENTRY" && policy.movementSequence !== "MULTI") {
      return "REENTRY_NOT_ALLOWED";
    }
  }
  return null;
}

type StoredEvent = {
  id: number;
  attendance_day_id: number | null;
  person_id: string;
  event_type: string;
  occurred_at: string;
  original_occurred_at: string | null;
  voided_at: string | null;
};

function storedEvent(ctx: LevelContext, eventId: number): StoredEvent | null {
  return (ctx.db
    .prepare(
      `SELECT id, attendance_day_id, person_id, event_type, occurred_at, original_occurred_at, voided_at
       FROM attendance_events WHERE id = ?`
    )
    .get(eventId) as unknown as StoredEvent | undefined) ?? null;
}

function audit(
  ctx: LevelContext,
  entry: {
    actor: string;
    action: string;
    entityId: string;
    previous?: unknown;
    next?: unknown;
    reason: string;
  }
): void {
  ctx.db
    .prepare(
      `INSERT INTO audit_logs (actor, action, entity_type, entity_id, previous_value, new_value, reason, created_at)
       VALUES (?, ?, 'attendance_event', ?, ?, ?, ?, ?)`
    )
    .run(
      entry.actor, entry.action, entry.entityId,
      entry.previous === undefined ? null : JSON.stringify(entry.previous),
      entry.next === undefined ? null : JSON.stringify(entry.next),
      entry.reason, new Date().toISOString()
    );
}

/** Qué movimiento se corrige y con qué hora nueva. */
export type CorrectionInput = {
  /** Hora local `HH:MM` dentro de la misma jornada. */
  time: string;
  reason: string;
  actor: string;
};

/**
 * Cambia la hora de un movimiento ya registrado.
 *
 * La hora nueva se interpreta en la fecha de la jornada y en la zona del nivel, con el offset real
 * de ese día: corregir una marcación de un día de invierno desde un día de verano no la desplaza.
 * El movimiento no puede mudarse de jornada —eso sería otra cosa, no una corrección—, así que sólo
 * se acepta una hora del mismo día.
 */
export function correctMovement(
  ctx: LevelContext,
  eventId: number,
  input: CorrectionInput
): void {
  const event = storedEvent(ctx, eventId);
  if (!event) throw new MarkError("EVENT_NOT_FOUND");
  if (event.voided_at) throw new MarkError("EVENT_VOIDED");
  if (!event.attendance_day_id) throw new MarkError("EVENT_WITHOUT_DAY");
  if (!input.reason.trim()) throw new MarkError("REASON_REQUIRED");

  const day = ctx.db
    .prepare(`SELECT id, work_date FROM attendance_days WHERE id = ?`)
    .get(event.attendance_day_id) as unknown as { id: number; work_date: string } | undefined;
  if (!day) throw new MarkError("EVENT_WITHOUT_DAY");

  const at = zonedDateTimeToUtc(ctx.timeZone, day.work_date, input.time);
  if (localDate(ctx, at) !== day.work_date) throw new MarkError("OUT_OF_DAY");

  const occurredAt = at.toISOString();
  if (occurredAt === event.occurred_at) return;

  const resulting = movementsOf(ctx, day.id).map((movement) =>
    movement.id === eventId
      ? { event_type: movement.event_type, occurred_at: occurredAt }
      : { event_type: movement.event_type, occurred_at: movement.occurred_at }
  );
  const problem = sequenceProblem(resulting, ctx.policy);
  if (problem) throw new MarkError(problem);

  const now = new Date().toISOString();
  ctx.db
    .prepare(
      `UPDATE attendance_events
       SET occurred_at = ?,
           original_occurred_at = COALESCE(original_occurred_at, ?),
           corrected_by = ?, corrected_at = ?, correction_reason = ?
       WHERE id = ?`
    )
    .run(occurredAt, event.occurred_at, input.actor, now, input.reason.trim(), eventId);

  // El intervalo es la lectura de dos movimientos; si uno se mueve, el intervalo lo sigue.
  ctx.db
    .prepare(`UPDATE attendance_intervals SET exited_at = ?, updated_at = ? WHERE exit_event_id = ?`)
    .run(occurredAt, now, eventId);
  ctx.db
    .prepare(`UPDATE attendance_intervals SET reentered_at = ?, updated_at = ? WHERE reentry_event_id = ?`)
    .run(occurredAt, now, eventId);

  audit(ctx, {
    actor: input.actor,
    action: "attendance.movement.correct",
    entityId: String(eventId),
    previous: { occurred_at: event.occurred_at },
    next: { occurred_at: occurredAt },
    reason: input.reason.trim(),
  });

  recomputeDay(ctx, day.id);
}

/**
 * Anula un movimiento registrado por error.
 *
 * No borra: la fila queda, con quién la anuló y por qué, y deja de contar. Sólo se puede anular si
 * lo que queda sigue siendo una jornada posible, lo que en la práctica obliga a deshacer desde el
 * final hacia atrás.
 */
export function voidMovement(
  ctx: LevelContext,
  eventId: number,
  input: { reason: string; actor: string }
): void {
  const event = storedEvent(ctx, eventId);
  if (!event) throw new MarkError("EVENT_NOT_FOUND");
  if (event.voided_at) throw new MarkError("ALREADY_VOIDED");
  if (!event.attendance_day_id) throw new MarkError("EVENT_WITHOUT_DAY");
  if (!input.reason.trim()) throw new MarkError("REASON_REQUIRED");

  const dayId = event.attendance_day_id;
  const resulting = movementsOf(ctx, dayId)
    .filter((movement) => movement.id !== eventId)
    .map((movement) => ({ event_type: movement.event_type, occurred_at: movement.occurred_at }));
  const problem = sequenceProblem(resulting, ctx.policy);
  if (problem) throw new MarkError(problem);

  const now = new Date().toISOString();
  ctx.db
    .prepare(`UPDATE attendance_events SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?`)
    .run(now, input.actor, input.reason.trim(), eventId);

  // Una salida anulada se lleva el intervalo que abrió: sin salida no hay ausencia intermedia.
  ctx.db
    .prepare(`UPDATE attendance_intervals SET voided_at = ?, updated_at = ? WHERE exit_event_id = ?`)
    .run(now, now, eventId);

  // Un reingreso anulado deja el intervalo abierto otra vez, y lo que se hubiera clasificado deja
  // de aplicar: describía una ausencia con principio y fin que ya no tiene fin.
  ctx.db
    .prepare(
      `UPDATE attendance_intervals
       SET reentry_event_id = NULL, reentered_at = NULL, reason_code = NULL, counts_as_work = NULL,
           classified_by = NULL, classified_at = NULL, updated_at = ?
       WHERE reentry_event_id = ?`
    )
    .run(now, eventId);

  audit(ctx, {
    actor: input.actor,
    action: "attendance.movement.void",
    entityId: String(eventId),
    previous: { event_type: event.event_type, occurred_at: event.occurred_at },
    reason: input.reason.trim(),
  });

  recomputeDay(ctx, dayId);
}

/* ------------------------------------------------------------------ *
 * Cierre automático
 * ------------------------------------------------------------------ */

export function autoCloseOpenDays(ctx: LevelContext, at: Date = new Date()): number {
  if (ctx.policy.autoCloseMode === "NONE") return 0;

  const today = localDate(ctx, at);
  const nowMinutes = localMinutes(ctx, at);
  const rows = ctx.db
    .prepare(
      `SELECT id, person_id, work_date, scheduled_end, late_minutes
       FROM attendance_days
       WHERE entry_at IS NOT NULL AND exit_at IS NULL AND work_date <= ?`
    )
    .all(today) as unknown as DayRow[];

  let closed = 0;
  for (const row of rows) {
    const last = lastMovement(ctx, row.id);
    if (last && ["EXIT", "AUTO_EXIT"].includes(last.event_type)) continue;

    const due = autoCloseDueMinute(
      ctx.policy,
      minutesFromHHMM(row.scheduled_end),
      row.late_minutes
    );
    if (due === null) continue;
    const overdue = row.work_date < today || nowMinutes >= due;
    if (!overdue) continue;

    // La salida se imputa al horario previsto, convertido con el offset real de esa fecha en la
    // zona del nivel. El sistema anterior concatenaba `-03:00`, lo que fallaba con horario de
    // verano.
    const theoreticalExit = zonedDateTimeToUtc(ctx.timeZone, row.work_date, row.scheduled_end);
    ctx.db
      .prepare(
        `INSERT INTO attendance_events (attendance_day_id, person_id, event_type, occurred_at, metadata)
         VALUES (?, ?, 'AUTO_EXIT', ?, ?)`
      )
      .run(
        row.id, row.person_id, theoreticalExit.toISOString(),
        JSON.stringify({
          source: "AUTO",
          graceMinutes: ctx.policy.autoCloseGraceMinutes,
          lateMinutes: row.late_minutes,
        })
      );

    ctx.db
      .prepare(`UPDATE attendance_days SET auto_close_processed_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), row.id);

    recomputeDay(ctx, row.id);
    closed += 1;
  }
  return closed;
}
