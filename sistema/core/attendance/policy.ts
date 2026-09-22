/**
 * Política de asistencia declarativa.
 *
 * Hoy la regla institucional está escrita en el código y además duplicada:
 *
 *   // lib/attendance.ts — registerEntry()
 *   const lateMinutes = rawLate > tolerance ? rawLate : 0;
 *   // app/api/admin/records/route.ts — misma regla, segunda copia
 *
 * «Hasta 15 minutos no hay atraso; si se supera, se computa el total desde la hora prevista» es
 * una decisión de un organismo, no una ley del dominio. La mayoría de las administraciones usa
 * la regla opuesta: se descuenta la tolerancia. Aquí ambas son valores de `latenessMode`, y el
 * cálculo vive en un único lugar.
 */

export type LatenessMode =
  /** Se computa sólo el exceso por encima de la tolerancia. */
  | "GRACE_ONLY"
  /** Superada la tolerancia, se computa todo el atraso desde la hora prevista. */
  | "FULL_FROM_SCHEDULED";

export type CompensationMode =
  /** El atraso no se compensa. */
  | "NONE"
  /** La permanencia posterior al horario compensa el atraso del mismo día. */
  | "SAME_DAY";

export type AutoCloseMode =
  /** La jornada abierta queda abierta. */
  | "NONE"
  /** Se cierra imputando la hora de salida prevista. */
  | "THEORETICAL_END";

export type MovementSequence =
  /** Entrada y salida únicas. */
  | "SIMPLE"
  /** Entrada → salida → reingreso → salida, con intervalos clasificables. */
  | "MULTI";

export type AttendancePolicy = {
  code: string;
  name: string;
  latenessToleranceMinutes: number;
  latenessMode: LatenessMode;
  /** Si la salida anticipada genera minutos pendientes. */
  countEarlyExit: boolean;
  compensationMode: CompensationMode;
  autoCloseMode: AutoCloseMode;
  autoCloseGraceMinutes: number;
  movementSequence: MovementSequence;
  /** Antes de esta fecha no se generan inasistencias. `null` = sin corte. */
  countingStartDate: string | null;
};

/**
 * Política por defecto del núcleo: neutra, sin ninguna regla institucional.
 * Un organismo que no configure nada obtiene el comportamiento más previsible.
 */
export const NEUTRAL_POLICY: AttendancePolicy = {
  code: "DEFAULT",
  name: "Política estándar",
  latenessToleranceMinutes: 0,
  latenessMode: "GRACE_ONLY",
  countEarlyExit: true,
  compensationMode: "NONE",
  autoCloseMode: "NONE",
  autoCloseGraceMinutes: 60,
  movementSequence: "SIMPLE",
  countingStartDate: null,
};

/**
 * Minutos de tardanza computables.
 * @param rawLateMinutes minutos transcurridos entre la hora prevista y la marcación real.
 */
export function computeLateness(policy: AttendancePolicy, rawLateMinutes: number): number {
  const late = Math.max(0, rawLateMinutes);
  if (late <= policy.latenessToleranceMinutes) return 0;
  return policy.latenessMode === "FULL_FROM_SCHEDULED"
    ? late
    : late - policy.latenessToleranceMinutes;
}

export type ClosureInput = {
  lateMinutes: number;
  /** Minutos de permanencia posteriores al horario de salida previsto. */
  minutesAfterScheduledEnd: number;
  /** Minutos de salida anticipada respecto del horario previsto. */
  earlyExitMinutes: number;
};

export type ClosureResult = {
  lateMinutes: number;
  earlyMinutes: number;
  compensationMinutes: number;
  pendingMinutes: number;
};

/**
 * Cierre de la jornada: cuánto se compensa y cuánto queda pendiente.
 * Con `compensationMode = "SAME_DAY"` reproduce el cálculo actual de `registerExit()`.
 */
export function computeClosure(policy: AttendancePolicy, input: ClosureInput): ClosureResult {
  const lateMinutes = Math.max(0, input.lateMinutes);
  const earlyMinutes = policy.countEarlyExit ? Math.max(0, input.earlyExitMinutes) : 0;
  const compensation =
    policy.compensationMode === "SAME_DAY"
      ? Math.min(lateMinutes, Math.max(0, input.minutesAfterScheduledEnd))
      : 0;
  const pendingMinutes = Math.max(0, lateMinutes - compensation) + earlyMinutes;
  return { lateMinutes, earlyMinutes, compensationMinutes: compensation, pendingMinutes };
}

/** Minuto del día a partir del cual una jornada abierta puede cerrarse automáticamente. */
export function autoCloseDueMinute(
  policy: AttendancePolicy,
  scheduledEndMinutes: number,
  lateMinutes: number
): number | null {
  if (policy.autoCloseMode === "NONE") return null;
  return scheduledEndMinutes + Math.max(0, lateMinutes) + policy.autoCloseGraceMinutes;
}

/** Si una fecha `YYYY-MM-DD` entra en el cómputo de inasistencias. */
export function countsForAbsences(policy: AttendancePolicy, date: string): boolean {
  if (!policy.countingStartDate) return true;
  return date >= policy.countingStartDate;
}
