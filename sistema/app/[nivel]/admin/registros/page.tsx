import { redirect } from "next/navigation";
import { sessionWith } from "@/lib/session";
import { zonedParts, formatTime, hhmmFromMinutes } from "@/core/platform/time";
import RegistrosPanel, { type MovementRow, type IntervalRow, type Option } from "./RegistrosPanel";

export const dynamic = "force-dynamic";

type RawMovement = {
  id: number;
  person: string;
  person_id: string;
  event_type: string;
  occurred_at: string;
  metadata: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  original_occurred_at: string | null;
  corrected_by: string | null;
  correction_reason: string | null;
};

type RawInterval = {
  id: number;
  person: string;
  exited_at: string;
  reentered_at: string | null;
  reason_code: string | null;
  counts_as_work: number | null;
  classified_by: string | null;
};

export default async function RegistrosPage({
  params,
  searchParams,
}: {
  params: Promise<{ nivel: string }>;
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { nivel } = await params;
  const session = await sessionWith(nivel, "attendance.read");
  if (!session) redirect(`/${nivel}/ingresar`);

  const { db, timeZone } = session.resolved.context;
  const locale = session.resolved.level.locale;

  const today = zonedParts(timeZone).date;
  const { fecha } = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fecha ?? "") ? fecha! : today;

  const people = db
    .prepare(
      `SELECT id, last_name || ', ' || first_name AS label
       FROM people WHERE active = 1 ORDER BY last_name, first_name`
    )
    .all()
    .map((row) => ({ ...row })) as unknown as Option[];

  const rawMovements = db
    .prepare(
      `SELECT e.id, e.event_type, e.occurred_at, e.metadata, e.person_id,
              e.voided_at, e.voided_by, e.void_reason,
              e.original_occurred_at, e.corrected_by, e.correction_reason,
              p.last_name || ', ' || p.first_name AS person
       FROM attendance_events e
       JOIN people p ON p.id = e.person_id
       JOIN attendance_days d ON d.id = e.attendance_day_id
       WHERE d.work_date = ?
         AND e.event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT')
       ORDER BY e.occurred_at, e.id`
    )
    .all(date) as unknown as RawMovement[];

  const movements: MovementRow[] = rawMovements.map((row) => {
    let source: string | null = null;
    let note: string | null = null;
    try {
      const meta = row.metadata ? (JSON.parse(row.metadata) as { source?: string; note?: string }) : null;
      source = meta?.source ?? null;
      note = meta?.note ?? null;
    } catch {
      // Un metadato ilegible no debe impedir ver el movimiento.
    }
    // La hora que se ofrece para corregir es la local del nivel en formato `HH:MM`, que es lo que
    // espera un `<input type="time">`; `local_time` está formateada para leer y puede traer otro
    // separador o el sufijo del locale.
    const parts = zonedParts(timeZone, new Date(row.occurred_at));
    return {
      id: row.id,
      person: row.person,
      person_id: row.person_id,
      event_type: row.event_type,
      local_time: formatTime(timeZone, locale, row.occurred_at),
      edit_time: hhmmFromMinutes(parts.hour * 60 + parts.minute),
      source: row.event_type === "AUTO_EXIT" ? "AUTO" : source,
      note,
      voided: row.voided_at !== null,
      voided_by: row.voided_by,
      void_reason: row.void_reason,
      corrected_by: row.corrected_by,
      correction_reason: row.correction_reason,
      original_time: row.original_occurred_at
        ? formatTime(timeZone, locale, row.original_occurred_at)
        : null,
    };
  });

  const rawIntervals = db
    .prepare(
      `SELECT i.id, i.exited_at, i.reentered_at, i.reason_code, i.counts_as_work, i.classified_by,
              p.last_name || ', ' || p.first_name AS person
       FROM attendance_intervals i
       JOIN people p ON p.id = i.person_id
       JOIN attendance_days d ON d.id = i.attendance_day_id
       WHERE d.work_date = ? AND i.voided_at IS NULL
       ORDER BY i.exited_at`
    )
    .all(date) as unknown as RawInterval[];

  const intervals: IntervalRow[] = rawIntervals.map((row) => ({
    id: row.id,
    person: row.person,
    exit_time: formatTime(timeZone, locale, row.exited_at),
    reentry_time: row.reentered_at ? formatTime(timeZone, locale, row.reentered_at) : null,
    minutes: row.reentered_at
      ? Math.max(0, Math.round((new Date(row.reentered_at).getTime() - new Date(row.exited_at).getTime()) / 60000))
      : null,
    reason_code: row.reason_code,
    counts_as_work: row.counts_as_work,
    classified_by: row.classified_by,
  }));

  return (
    <RegistrosPanel
      nivel={nivel}
      fecha={date}
      people={people}
      movements={movements}
      intervals={intervals}
      puedeMarcar={session.user.permissions.includes("attendance.mark_manual")}
      puedeClasificar={session.user.permissions.includes("attendance.write")}
      puedeCorregir={session.user.permissions.includes("attendance.write")}
    />
  );
}
