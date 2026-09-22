"use server";

import { revalidatePath } from "next/cache";
import { sessionWith } from "@/lib/session";
import { setPin } from "@/core/attendance/service";
import { getSetting } from "@/core/config/store";

export type ActionState = { error: string | null; message: string | null };

export const emptyState: ActionState = { error: null, message: null };

function fail(error: string): ActionState {
  return { error, message: null };
}

/** "1-5" o "1,3,5". Lunes = 1, domingo = 7. */
function parseDays(value: string): number[] {
  const parsed = value.includes("-")
    ? (() => {
        const [from, to] = value.split("-").map(Number);
        return Array.from({ length: to - from + 1 }, (_, i) => from + i);
      })()
    : value.split(",").map(Number);
  return [...new Set(parsed)].filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function guardarPersona(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "people.manage");
  if (!session) return fail("No tenés permiso para administrar el padrón.");

  const apellido = String(formData.get("apellido") ?? "").trim();
  const nombre = String(formData.get("nombre") ?? "").trim();
  const documento = String(formData.get("documento") ?? "").trim();
  const desde = String(formData.get("desde") ?? "");
  const hasta = String(formData.get("hasta") ?? "");
  const dias = parseDays(String(formData.get("dias") ?? "1-5"));
  const antiguedad = String(formData.get("antiguedad") ?? "").trim();

  if (!apellido || !nombre || !documento) return fail("Completá apellido, nombre y documento.");
  if (!TIME.test(desde) || !TIME.test(hasta)) return fail("Los horarios deben tener la forma 08:00.");
  if (desde >= hasta) return fail("La hora de salida tiene que ser posterior a la de entrada.");
  if (!dias.length) return fail("Indicá al menos un día, entre 1 (lunes) y 7 (domingo).");
  if (antiguedad && !/^\d{4}-\d{2}-\d{2}$/.test(antiguedad)) {
    return fail("La fecha de antigüedad no es válida.");
  }

  const { db } = session.resolved.context;
  const now = new Date().toISOString();

  const existing = db
    .prepare(`SELECT id FROM people WHERE national_id = ?`)
    .get(documento) as unknown as { id: string } | undefined;
  const personId = existing?.id ?? crypto.randomUUID();

  db.prepare(
    `INSERT INTO people (id, last_name, first_name, national_id, employment, seniority_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(national_id) DO UPDATE SET
       last_name = excluded.last_name, first_name = excluded.first_name,
       employment = excluded.employment, seniority_date = excluded.seniority_date,
       updated_at = excluded.updated_at`
  ).run(
    personId, apellido, nombre, documento,
    String(formData.get("situacion") ?? "").trim() || null,
    antiguedad || null, now, now
  );

  // El horario se reemplaza entero: es más simple de razonar que ir agregando días sueltos.
  db.prepare(`DELETE FROM person_schedules WHERE person_id = ?`).run(personId);
  for (const weekday of dias) {
    db.prepare(
      `INSERT INTO person_schedules (person_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)`
    ).run(personId, weekday, desde, hasta);
  }

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, new_value, created_at)
     VALUES (?, ?, 'person', ?, ?, ?)`
  ).run(
    session.user.email, existing ? "UPDATE_PERSON" : "CREATE_PERSON", personId,
    JSON.stringify({ apellido, nombre, documento, desde, hasta, dias }), now
  );

  revalidatePath(`/${nivel}/admin/personal`);
  return {
    error: null,
    message: `${existing ? "Actualizado" : "Agregado"}: ${apellido}, ${nombre}.`,
  };
}

/**
 * Genera un PIN provisorio y lo devuelve una sola vez.
 *
 * Se muestra en pantalla porque no se puede recuperar después: en la base queda el hash, no el
 * número. Vence según la configuración del nivel.
 */
export async function generarPin(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "people.credentials");
  if (!session) return fail("No tenés permiso para gestionar credenciales.");

  const personId = String(formData.get("personId") ?? "");
  const { db } = session.resolved.context;
  const person = db
    .prepare(`SELECT last_name, first_name FROM people WHERE id = ?`)
    .get(personId) as unknown as { last_name: string; first_name: string } | undefined;
  if (!person) return fail("La persona no existe.");

  const length = Number(getSetting<number>(db, "attendance.pin_length") ?? 4);
  const validDays = Number(getSetting<number>(db, "attendance.temporary_pin_valid_days") ?? 7);

  // Rechazo por módulo: tomar el resto de un aleatorio sesga los primeros valores.
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(length * 4)))
    .filter((byte) => byte < 250)
    .slice(0, length)
    .map((byte) => byte % 10)
    .join("");
  if (digits.length < length) return fail("No se pudo generar el PIN. Probá de nuevo.");

  const expiresAt = new Date(Date.now() + validDays * 86_400_000).toISOString();
  await setPin(session.resolved.context, personId, digits, {
    forceChange: true,
    expiresAt,
    source: "ADMIN",
  });

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, reason, created_at)
     VALUES (?, 'ISSUE_TEMPORARY_PIN', 'person', ?, ?, ?)`
  ).run(session.user.email, personId, `Vence el ${expiresAt.slice(0, 10)}`, new Date().toISOString());

  revalidatePath(`/${nivel}/admin/personal`);
  return {
    error: null,
    message: `PIN provisorio de ${person.last_name}, ${person.first_name}: ${digits} — vence el ${expiresAt.slice(0, 10)}. Anotalo: no se puede volver a ver.`,
  };
}

export async function cambiarEstado(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "people.manage");
  if (!session) return fail("No tenés permiso para administrar el padrón.");

  const personId = String(formData.get("personId") ?? "");
  const activar = String(formData.get("activar") ?? "") === "1";
  const { db } = session.resolved.context;

  db.prepare(`UPDATE people SET active = ?, updated_at = ? WHERE id = ?`).run(
    activar ? 1 : 0, new Date().toISOString(), personId
  );
  // Al dar de baja se libera el teléfono, para que pueda vincularse a otra persona.
  if (!activar) {
    db.prepare(`UPDATE devices SET active = 0, revoked_at = ? WHERE person_id = ? AND active = 1`)
      .run(new Date().toISOString(), personId);
  }

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, created_at)
     VALUES (?, ?, 'person', ?, ?)`
  ).run(session.user.email, activar ? "ACTIVATE_PERSON" : "DEACTIVATE_PERSON", personId, new Date().toISOString());

  revalidatePath(`/${nivel}/admin/personal`);
  return { error: null, message: activar ? "Agente reactivado." : "Agente dado de baja." };
}

export async function desvincularDispositivo(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "people.credentials");
  if (!session) return fail("No tenés permiso para gestionar credenciales.");

  const personId = String(formData.get("personId") ?? "");
  const { db } = session.resolved.context;
  const result = db
    .prepare(`UPDATE devices SET active = 0, revoked_at = ? WHERE person_id = ? AND active = 1`)
    .run(new Date().toISOString(), personId);

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, created_at)
     VALUES (?, 'UNBIND_DEVICE', 'person', ?, ?)`
  ).run(session.user.email, personId, new Date().toISOString());

  revalidatePath(`/${nivel}/admin/personal`);
  return {
    error: null,
    message: Number(result.changes) > 0
      ? "Teléfono desvinculado. La próxima marcación va a vincular el que se use."
      : "No tenía ningún teléfono vinculado.",
  };
}
