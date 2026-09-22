"use server";

import { revalidatePath } from "next/cache";
import { sessionWith } from "@/lib/session";
import {
  markEntry,
  markExit,
  markReentry,
  classifyInterval,
  correctMovement,
  voidMovement,
  MarkError,
} from "@/core/attendance/service";
import { zonedDateTimeToUtc } from "@/core/platform/time";
import { type ActionState, MANUAL_REASONS, INTERVAL_REASONS, CORRECTION_REASONS } from "./shared";

function fail(error: string): ActionState {
  return { error, message: null };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const MARK_ERRORS: Record<string, string> = {
  NO_SCHEDULE: "El agente no tiene horario asignado para esa fecha.",
  ON_ABSENCE: "El agente figura con una licencia vigente en esa fecha.",
  ENTRY_EXISTS: "Ya hay una entrada registrada para esa jornada.",
  NO_ENTRY: "No se puede registrar una salida sin una entrada previa.",
  EXIT_NOT_ALLOWED: "La secuencia actual no admite una salida.",
  REENTRY_NOT_ALLOWED: "La secuencia actual no admite un reingreso.",
  EVENT_NOT_FOUND: "El movimiento ya no existe.",
  EVENT_VOIDED: "El movimiento está anulado: no se puede corregir.",
  ALREADY_VOIDED: "El movimiento ya estaba anulado.",
  EVENT_WITHOUT_DAY: "El movimiento no está asociado a ninguna jornada.",
  REASON_REQUIRED: "Indicá el motivo de la corrección.",
  OUT_OF_DAY: "La hora nueva cae en otra jornada. Anulá el movimiento y cargalo en la fecha que corresponde.",
  MUST_START_WITH_ENTRY:
    "La jornada quedaría empezando por algo que no es una entrada. Corregí o anulá desde el último movimiento hacia atrás.",
  DUPLICATE_ENTRY: "La jornada quedaría con dos entradas.",
  OUT_OF_ORDER: "Quedarían dos movimientos seguidos en el mismo sentido. Corregí desde el último hacia atrás.",
  SAME_INSTANT: "Ya hay otro movimiento a esa misma hora.",
};

/**
 * Marcación manual excepcional.
 *
 * Pasa por las mismas funciones que la marcación desde el celular, así que aplica la misma
 * política y actualiza la misma proyección. Lo único distinto es el origen, que queda asentado
 * en el evento y en la auditoría: un registro cargado a mano tiene que poder distinguirse de uno
 * hecho por el propio agente.
 */
export async function marcarManual(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "attendance.mark_manual");
  if (!session) return fail("No tenés permiso para registrar marcaciones manuales.");

  const personId = String(formData.get("personId") ?? "");
  const fecha = String(formData.get("fecha") ?? "");
  const hora = String(formData.get("hora") ?? "");
  const movimiento = String(formData.get("movimiento") ?? "");
  const motivo = String(formData.get("motivo") ?? "");
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 500);

  if (!personId) return fail("Elegí un agente.");
  if (!DATE.test(fecha) || !TIME.test(hora)) return fail("La fecha o la hora no son válidas.");
  if (!MANUAL_REASONS.some((reason) => reason.value === motivo)) return fail("Elegí un motivo.");
  if (motivo === "OTHER" && !nota) return fail("Para «otra causa» hace falta una observación.");
  if (!["ENTRY", "EXIT", "REENTRY"].includes(movimiento)) return fail("Movimiento inválido.");

  const { context } = session.resolved;
  // La hora que carga el administrador es local del nivel; se convierte con el offset real de esa
  // fecha, no con uno fijo.
  const at = zonedDateTimeToUtc(context.timeZone, fecha, hora);
  if (at.getTime() > Date.now() + 60_000) {
    return fail("No se puede registrar una marcación en el futuro.");
  }

  const input = {
    personId,
    at,
    coordinates: null,
    distanceMeters: null,
    source: "ADMIN" as const,
    note: `${motivo}${nota ? ` — ${nota}` : ""}`,
  };

  try {
    if (movimiento === "ENTRY") markEntry(context, input);
    else if (movimiento === "EXIT") markExit(context, input);
    else markReentry(context, input);
  } catch (error) {
    if (error instanceof MarkError) return fail(MARK_ERRORS[error.code] ?? "No se pudo registrar.");
    throw error;
  }

  context.db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, new_value, reason, created_at)
     VALUES (?, 'MANUAL_MARK', 'person', ?, ?, ?, ?)`
  ).run(
    session.user.email, personId,
    JSON.stringify({ movimiento, fecha, hora }), `${motivo}${nota ? ` — ${nota}` : ""}`,
    new Date().toISOString()
  );

  revalidatePath(`/${nivel}/admin/registros`);
  return { error: null, message: "Marcación registrada." };
}

export async function clasificarIntervalo(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "attendance.write");
  if (!session) return fail("No tenés permiso para clasificar salidas.");

  const intervalId = Number(formData.get("intervalId"));
  const motivo = String(formData.get("motivo") ?? "");
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 500);
  const reason = INTERVAL_REASONS.find((candidate) => candidate.value === motivo);

  if (!Number.isInteger(intervalId)) return fail("Intervalo inválido.");
  if (!reason) return fail("Elegí un motivo.");

  // Cada motivo trae su criterio por defecto, pero quien clasifica puede decidir otra cosa:
  // la casilla manda por encima del valor sugerido.
  const countsAsWork = formData.get("computa") === "on";

  classifyInterval(session.resolved.context, intervalId, {
    reasonCode: motivo,
    countsAsWork,
    note: nota || null,
    actor: session.user.email,
  });

  session.resolved.context.db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, new_value, created_at)
     VALUES (?, 'CLASSIFY_INTERVAL', 'attendance_interval', ?, ?, ?)`
  ).run(
    session.user.email, String(intervalId),
    JSON.stringify({ motivo, countsAsWork }), new Date().toISOString()
  );

  revalidatePath(`/${nivel}/admin/registros`);
  return { error: null, message: "Salida clasificada." };
}

/**
 * Corrige la hora de un movimiento ya registrado.
 *
 * Es la contracara de la marcación manual: esa agrega lo que faltó, ésta arregla lo que quedó mal.
 * Ambas terminan en `recomputeDay()`, así que la tardanza y la compensación se recalculan con la
 * misma regla y no hace falta tocar la jornada a mano.
 */
export async function corregirMovimiento(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "attendance.write");
  if (!session) return fail("No tenés permiso para corregir registros.");

  const eventId = Number(formData.get("eventId"));
  const hora = String(formData.get("hora") ?? "");
  const motivo = String(formData.get("motivo") ?? "");
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 500);

  if (!Number.isInteger(eventId)) return fail("Movimiento inválido.");
  if (!TIME.test(hora)) return fail("La hora no es válida.");
  if (!CORRECTION_REASONS.some((reason) => reason.value === motivo)) return fail("Elegí un motivo.");
  if (motivo === "OTHER" && !nota) return fail("Para «otra causa» hace falta una observación.");

  try {
    correctMovement(session.resolved.context, eventId, {
      time: hora,
      reason: `${motivo}${nota ? ` — ${nota}` : ""}`,
      actor: session.user.email,
    });
  } catch (error) {
    if (error instanceof MarkError) return fail(MARK_ERRORS[error.code] ?? "No se pudo corregir.");
    throw error;
  }

  revalidatePath(`/${nivel}/admin/registros`);
  return { error: null, message: "Movimiento corregido." };
}

/** Anula un movimiento cargado por error. La fila queda en la base, marcada y con su motivo. */
export async function anularMovimiento(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "attendance.write");
  if (!session) return fail("No tenés permiso para anular registros.");

  const eventId = Number(formData.get("eventId"));
  const motivo = String(formData.get("motivo") ?? "");
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 500);

  if (!Number.isInteger(eventId)) return fail("Movimiento inválido.");
  if (!CORRECTION_REASONS.some((reason) => reason.value === motivo)) return fail("Elegí un motivo.");
  if (motivo === "OTHER" && !nota) return fail("Para «otra causa» hace falta una observación.");

  try {
    voidMovement(session.resolved.context, eventId, {
      reason: `${motivo}${nota ? ` — ${nota}` : ""}`,
      actor: session.user.email,
    });
  } catch (error) {
    if (error instanceof MarkError) return fail(MARK_ERRORS[error.code] ?? "No se pudo anular.");
    throw error;
  }

  revalidatePath(`/${nivel}/admin/registros`);
  return { error: null, message: "Movimiento anulado." };
}
