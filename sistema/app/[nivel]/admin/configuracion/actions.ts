"use server";

import { revalidatePath } from "next/cache";
import { sessionWith } from "@/lib/session";
import { allDefinitions, validateSetting } from "@/core/config/definitions";
import { setSetting } from "@/core/config/store";
import { type ActionState } from "./shared";

function fail(error: string): ActionState {
  return { error, message: null };
}

/**
 * Guarda la configuración del nivel.
 *
 * El formulario se genera desde el registro de definiciones, así que esta acción no conoce ningún
 * parámetro en particular: recorre las definiciones, toma lo que vino del formulario y lo valida
 * con la regla declarada. Agregar un parámetro nuevo es agregar un `defineSetting`; ni esta
 * función ni la pantalla cambian.
 *
 * Valida todo antes de escribir nada: un valor inválido cancela el lote entero, para no dejar la
 * configuración a medias.
 */
export async function guardarConfiguracion(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "settings.write");
  if (!session) return fail("No tenés permiso para modificar la configuración.");

  const { db } = session.resolved.context;

  const validated: { key: string; value: unknown }[] = [];
  const errors: string[] = [];

  for (const definition of allDefinitions()) {
    // Los parámetros de sede no se editan acá: cada sede guarda los suyos en su pantalla.
    if (definition.scope === "LOCATION") continue;

    const raw = formData.get(definition.key);
    if (raw === null) continue;

    // Una casilla sin marcar no se envía; su ausencia es el valor `false`.
    const value = definition.type === "boolean" ? formData.get(definition.key) === "on" : raw;

    const result = validateSetting(definition.key, value);
    if (!result.ok) errors.push(result.error);
    else validated.push({ key: definition.key, value: result.value });
  }

  // Las casillas no marcadas no llegan en el formulario, así que se agregan explícitamente.
  for (const definition of allDefinitions()) {
    if (definition.type !== "boolean" || definition.scope === "LOCATION") continue;
    if (validated.some((entry) => entry.key === definition.key)) continue;
    validated.push({ key: definition.key, value: false });
  }

  if (errors.length) return fail(errors.join(" "));

  for (const entry of validated) {
    setSetting(db, entry.key, entry.value, session.user.email, null);
  }

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, created_at)
     VALUES (?, 'UPDATE_SETTINGS', 'settings', ?, ?)`
  ).run(session.user.email, "LEVEL", new Date().toISOString());

  revalidatePath(`/${nivel}`, "layout");
  return { error: null, message: "Configuración guardada." };
}

const TIME_MODES = ["GRACE_ONLY", "FULL_FROM_SCHEDULED"];
const COMPENSATION = ["NONE", "SAME_DAY"];
const AUTO_CLOSE = ["NONE", "THEORETICAL_END"];
const SEQUENCES = ["SIMPLE", "MULTI"];

/**
 * Guarda la política de asistencia.
 *
 * Esto es lo que en el sistema anterior estaba escrito en el código, y en tres lugares distintos.
 */
export async function guardarPolitica(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "rules.manage");
  if (!session) return fail("No tenés permiso para editar las reglas.");

  const tolerancia = Number(formData.get("tolerancia"));
  const modo = String(formData.get("modo") ?? "");
  const compensacion = String(formData.get("compensacion") ?? "");
  const cierre = String(formData.get("cierre") ?? "");
  const gracia = Number(formData.get("gracia"));
  const secuencia = String(formData.get("secuencia") ?? "");
  const desde = String(formData.get("computoDesde") ?? "").trim();

  if (!Number.isInteger(tolerancia) || tolerancia < 0 || tolerancia > 240) {
    return fail("La tolerancia debe estar entre 0 y 240 minutos.");
  }
  if (!Number.isInteger(gracia) || gracia < 0 || gracia > 720) {
    return fail("La gracia del cierre automático debe estar entre 0 y 720 minutos.");
  }
  if (!TIME_MODES.includes(modo) || !COMPENSATION.includes(compensacion)) {
    return fail("Modo de tardanza o compensación inválidos.");
  }
  if (!AUTO_CLOSE.includes(cierre) || !SEQUENCES.includes(secuencia)) {
    return fail("Modo de cierre o secuencia inválidos.");
  }
  if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
    return fail("La fecha de inicio de cómputo no es válida.");
  }

  const { db } = session.resolved.context;
  db.prepare(
    `UPDATE attendance_policies
     SET lateness_tolerance_minutes = ?, lateness_mode = ?, count_early_exit = ?,
         compensation_mode = ?, auto_close_mode = ?, auto_close_grace_minutes = ?,
         movement_sequence = ?, counting_start_date = ?
     WHERE is_default = 1`
  ).run(
    tolerancia, modo, formData.get("salidaAnticipada") === "on" ? 1 : 0,
    compensacion, cierre, gracia, secuencia, desde || null
  );

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, new_value, created_at)
     VALUES (?, 'UPDATE_POLICY', 'attendance_policy', 'default', ?, ?)`
  ).run(
    session.user.email,
    JSON.stringify({ tolerancia, modo, compensacion, cierre, gracia, secuencia, desde }),
    new Date().toISOString()
  );

  revalidatePath(`/${nivel}`, "layout");
  return { error: null, message: "Política de asistencia guardada." };
}

