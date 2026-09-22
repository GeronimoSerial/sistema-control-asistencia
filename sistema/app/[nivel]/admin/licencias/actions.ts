"use server";

import { revalidatePath } from "next/cache";
import { sessionWith } from "@/lib/session";
import { loadAbsenceTypes, consumptionFor } from "@/core/absence/repository";
import { canRegister } from "@/core/absence/quota";
import { computeDays } from "@/core/absence/days";
import { type ActionState } from "./shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(error: string): ActionState {
  return { error, message: null, warning: null };
}

export async function registrarAusencia(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "absence.write");
  if (!session) return fail("No tenés permiso para registrar licencias.");

  const personId = String(formData.get("personId") ?? "");
  const typeCode = String(formData.get("typeCode") ?? "");
  const from = String(formData.get("desde") ?? "");
  const to = String(formData.get("hasta") ?? "");
  const eventKey = String(formData.get("evento") ?? "").trim();
  const observation = String(formData.get("observacion") ?? "").trim().slice(0, 500);
  const manualDays = Number(formData.get("dias") ?? 0);

  if (!personId) return fail("Elegí un agente.");
  if (!DATE.test(from) || !DATE.test(to)) return fail("Las fechas no son válidas.");
  if (to < from) return fail("La fecha de fin no puede ser anterior a la de inicio.");

  const { context } = session.resolved;
  const { db } = context;

  const type = loadAbsenceTypes(db).find((candidate) => candidate.code === typeCode);
  if (!type) return fail("El tipo de licencia no existe.");

  const person = db
    .prepare(`SELECT last_name, first_name FROM people WHERE id = ? AND active = 1`)
    .get(personId) as unknown as { last_name: string; first_name: string } | undefined;
  if (!person) return fail("El agente no existe o está dado de baja.");

  const workingDays = (db
    .prepare(`SELECT weekday FROM person_schedules WHERE person_id = ?`)
    .all(personId) as unknown as { weekday: number }[]).map((row) => row.weekday);

  const days = computeDays({
    basis: type.dayBasis,
    from,
    to,
    workingDays,
    manualDays,
  });
  if (days <= 0) {
    return fail(
      type.dayBasis === "MANUAL"
        ? "Para este tipo hay que indicar la cantidad de días."
        : "El período elegido no computa ningún día para este tipo de licencia."
    );
  }

  // Se consulta antes de escribir: si la cuota está agotada, no se registra.
  const consumption = consumptionFor(db, personId, type.id, from, eventKey || null);
  const verdict = canRegister(type, consumption, days);
  if (!verdict.allowed) {
    return fail(
      verdict.reason === "QUOTA_EXHAUSTED"
        ? `${person.last_name} ya agotó la cuota de ${type.name}.`
        : `No se puede registrar: con estos ${days} días se superaría el máximo de ${type.name}.`
    );
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO absence_records
       (id, person_id, absence_type_id, event_key, date_from, date_to, computed_days,
        observation, warning_text, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(), personId, type.id, eventKey || null, from, to, days,
    observation || null, verdict.evaluation.warnings.join(" ") || null,
    session.user.email, now, now
  );

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, new_value, created_at)
     VALUES (?, 'REGISTER_ABSENCE', 'person', ?, ?, ?)`
  ).run(session.user.email, personId, JSON.stringify({ typeCode, from, to, days }), now);

  revalidatePath(`/${nivel}/admin/licencias`);
  return {
    error: null,
    message: `Registrado: ${type.name} para ${person.last_name}, ${person.first_name} — ${days} ${days === 1 ? "día" : "días"}.`,
    warning: verdict.evaluation.warnings.join(" ") || null,
  };
}

export async function anularAusencia(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "absence.write");
  if (!session) return fail("No tenés permiso para anular licencias.");

  const id = String(formData.get("id") ?? "");
  const { db } = session.resolved.context;
  const now = new Date().toISOString();

  // Se marca inactiva en lugar de borrarla: el registro queda para la auditoría.
  const result = db
    .prepare(`UPDATE absence_records SET active = 0, updated_at = ? WHERE id = ? AND active = 1`)
    .run(now, id);

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, created_at)
     VALUES (?, 'CANCEL_ABSENCE', 'absence', ?, ?)`
  ).run(session.user.email, id, now);

  revalidatePath(`/${nivel}/admin/licencias`);
  return {
    error: null,
    message: Number(result.changes) > 0 ? "Licencia anulada." : "La licencia ya estaba anulada.",
    warning: null,
  };
}
