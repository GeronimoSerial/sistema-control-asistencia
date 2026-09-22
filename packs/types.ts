/**
 * Formato de un *rule pack*.
 *
 * Un pack describe, como datos, todo lo que hoy está escrito en el código para un organismo
 * concreto: su marca, su zona horaria, su catálogo de ausencias con las cuotas, sus escalas de
 * derecho, su política de asistencia y sus roles iniciales.
 *
 * El núcleo no importa ningún pack. Se aplican desde el módulo de administración al dar de alta
 * un organismo, o desde el script de instalación.
 */

import type { QuotaWindow, OnExhausted } from "@/core/absence/quota";
import type {
  LatenessMode,
  CompensationMode,
  AutoCloseMode,
  MovementSequence,
} from "@/core/attendance/policy";

export type PackQuotaTier = {
  order: number;
  label?: string;
  window: QuotaWindow;
  windowDays?: number | null;
  limitDays: number | null;
  payRate: number;
  onExhausted: OnExhausted;
};

export type PackAbsenceType = {
  code: string;
  name: string;
  categoryCode: string;
  reference?: string | null;
  dayBasis: "CALENDAR" | "BUSINESS" | "SCHEDULED" | "MANUAL";
  requiresDocument?: boolean;
  notes?: string | null;
  tiers: PackQuotaTier[];
};

export type PackEntitlementScale = {
  code: string;
  name: string;
  basis: "SENIORITY_YEARS" | "SERVICE_MONTHS";
  proration: "NONE" | "MONTHLY_TWELFTHS";
  fullAfterMonths: number | null;
  extraFractionOverDays: number | null;
  tiers: { fromValue: number; toValue: number | null; days: number }[];
};

export type PackAttendancePolicy = {
  code: string;
  name: string;
  latenessToleranceMinutes: number;
  latenessMode: LatenessMode;
  countEarlyExit: boolean;
  compensationMode: CompensationMode;
  autoCloseMode: AutoCloseMode;
  autoCloseGraceMinutes: number;
  movementSequence: MovementSequence;
  countingStartDate: string | null;
};

export type PackRole = {
  code: string;
  name: string;
  description?: string;
  permissions: string[];
};

export type RulePack = {
  id: string;
  name: string;
  version: string;
  description?: string;
  organization: { timeZone: string; locale: string };
  settings: Record<string, unknown>;
  attendancePolicies: PackAttendancePolicy[];
  absenceCategories: { code: string; name: string }[];
  absenceTypes: PackAbsenceType[];
  entitlementScales: PackEntitlementScale[];
  roles: PackRole[];
};
