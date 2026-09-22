/**
 * Carga de la política de asistencia vigente.
 *
 * Durante la transición conviven dos fuentes: la tabla `attendance_policies` (nueva, por
 * organización) y `office_settings` (vieja, fila única). Si el organismo todavía no fue
 * instalado, se arma una política equivalente a la que el sistema aplicaba hasta ahora, de modo
 * que el comportamiento no cambie mientras se completa la migración.
 */

import { sql } from "@/core/platform/db";
import { NEUTRAL_POLICY, type AttendancePolicy } from "@/core/attendance/policy";

type PolicyRow = {
  code: string;
  name: string;
  lateness_tolerance_minutes: number;
  lateness_mode: string;
  count_early_exit: boolean;
  compensation_mode: string;
  auto_close_mode: string;
  auto_close_grace_minutes: number;
  movement_sequence: string;
  counting_start_date: string | null;
};

function toPolicy(row: PolicyRow): AttendancePolicy {
  return {
    code: String(row.code),
    name: String(row.name),
    latenessToleranceMinutes: Number(row.lateness_tolerance_minutes),
    latenessMode: String(row.lateness_mode) as AttendancePolicy["latenessMode"],
    countEarlyExit: Boolean(row.count_early_exit),
    compensationMode: String(row.compensation_mode) as AttendancePolicy["compensationMode"],
    autoCloseMode: String(row.auto_close_mode) as AttendancePolicy["autoCloseMode"],
    autoCloseGraceMinutes: Number(row.auto_close_grace_minutes),
    movementSequence: String(row.movement_sequence) as AttendancePolicy["movementSequence"],
    countingStartDate: row.counting_start_date ? String(row.counting_start_date).slice(0, 10) : null,
  };
}

/**
 * Política del comportamiento anterior al refactor, construida desde `office_settings`.
 * Es el fallback mientras un organismo no tenga su política propia cargada.
 */
async function legacyPolicy(): Promise<AttendancePolicy> {
  try {
    const rows = (await sql()`
      SELECT lateness_tolerance_minutes, auto_close_grace_minutes, absence_count_start_date
      FROM office_settings WHERE id = 1 LIMIT 1
    `) as unknown as {
      lateness_tolerance_minutes: number | null;
      auto_close_grace_minutes: number | null;
      absence_count_start_date: string | null;
    }[];
    const row = rows[0];
    return {
      ...NEUTRAL_POLICY,
      code: "LEGACY",
      name: "Configuración anterior",
      latenessToleranceMinutes: Number(row?.lateness_tolerance_minutes ?? 15),
      latenessMode: "FULL_FROM_SCHEDULED",
      countEarlyExit: true,
      compensationMode: "SAME_DAY",
      autoCloseMode: "THEORETICAL_END",
      autoCloseGraceMinutes: Number(row?.auto_close_grace_minutes ?? 60),
      movementSequence: "MULTI",
      countingStartDate: row?.absence_count_start_date
        ? String(row.absence_count_start_date).slice(0, 10)
        : null,
    };
  } catch {
    return { ...NEUTRAL_POLICY, latenessToleranceMinutes: 15, latenessMode: "FULL_FROM_SCHEDULED" };
  }
}

export async function loadAttendancePolicy(
  organizationId: string | null
): Promise<AttendancePolicy> {
  if (!organizationId) return legacyPolicy();
  try {
    const rows = (await sql()`
      SELECT code, name, lateness_tolerance_minutes, lateness_mode, count_early_exit,
             compensation_mode, auto_close_mode, auto_close_grace_minutes, movement_sequence,
             counting_start_date
      FROM attendance_policies
      WHERE organization_id = ${organizationId} AND is_default
      LIMIT 1
    `) as unknown as PolicyRow[];
    return rows[0] ? toPolicy(rows[0]) : legacyPolicy();
  } catch {
    // La tabla todavía no existe: el organismo no fue instalado.
    return legacyPolicy();
  }
}
