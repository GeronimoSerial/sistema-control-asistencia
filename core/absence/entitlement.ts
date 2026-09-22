/**
 * Escalas de derecho por antigüedad.
 *
 * Reemplaza a `baseDays()` y `entitlement()` de `app/api/admin/vacation-status/route.ts`:
 *
 *   function baseDays(years){ return years<=5?20 : years<=10?25 : years<=15?30 : 35 }
 *   function entitlement(years, months, extra){
 *     const base = baseDays(years);
 *     if (months >= 6) return base;
 *     const units = Math.min(12, Math.max(0, months) + (extra ? 1 : 0));
 *     return Math.round((base/12*units)*100)/100;
 *   }
 *
 * La escala 20/25/30/35 pasa a ser cuatro filas de datos y el proporcional por doceavos, dos
 * campos de la escala. El núcleo no conoce ninguna cifra.
 */

export type ScaleBasis = "SENIORITY_YEARS" | "SERVICE_MONTHS";

export type ProrationMode =
  /** Se otorga el tramo completo siempre. */
  | "NONE"
  /** Proporcional en doceavos de los meses de servicio efectivos. */
  | "MONTHLY_TWELFTHS";

export type ScaleTier = {
  /** Valor mínimo del tramo, inclusive. */
  fromValue: number;
  /** Valor máximo del tramo, inclusive. `null` = sin tope superior. */
  toValue: number | null;
  days: number;
};

export type EntitlementScale = {
  code: string;
  name: string;
  basis: ScaleBasis;
  proration: ProrationMode;
  /**
   * A partir de cuántos meses de servicio se accede al tramo completo sin prorratear.
   * `null` desactiva el prorrateo por antigüedad parcial.
   */
  fullAfterMonths: number | null;
  /**
   * Si una fracción de servicio mayor a este número de días suma un doceavo adicional.
   * `null` desactiva la regla.
   */
  extraFractionOverDays: number | null;
  tiers: ScaleTier[];
};

export type EntitlementInput = {
  /** Años de antigüedad o meses de servicio, según `basis`. */
  basisValue: number;
  /** Meses de servicio efectivos en el período. */
  serviceMonths: number;
  /** Si hay una fracción que supera `extraFractionOverDays`. */
  hasExtraFraction?: boolean;
};

export type EntitlementResult = {
  /** Días del tramo antes de prorratear. */
  baseDays: number;
  /** Días efectivamente otorgados. */
  entitlementDays: number;
  prorated: boolean;
  /** Doceavos aplicados, cuando hubo prorrateo. */
  twelfths: number | null;
  tier: ScaleTier | null;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Busca el tramo que contiene `value`. Devuelve `null` si la escala no lo cubre. */
export function findTier(scale: EntitlementScale, value: number): ScaleTier | null {
  const ordered = [...scale.tiers].sort((a, b) => a.fromValue - b.fromValue);
  for (const tier of ordered) {
    const aboveFloor = value >= tier.fromValue;
    const belowCeiling = tier.toValue === null || value <= tier.toValue;
    if (aboveFloor && belowCeiling) return tier;
  }
  return null;
}

export function evaluateEntitlement(
  scale: EntitlementScale,
  input: EntitlementInput
): EntitlementResult {
  const tier = findTier(scale, input.basisValue);
  if (!tier) {
    return { baseDays: 0, entitlementDays: 0, prorated: false, twelfths: null, tier: null };
  }

  const base = tier.days;
  const threshold = scale.fullAfterMonths;
  const needsProration =
    scale.proration === "MONTHLY_TWELFTHS" &&
    threshold !== null &&
    input.serviceMonths < threshold;

  if (!needsProration) {
    return { baseDays: base, entitlementDays: base, prorated: false, twelfths: null, tier };
  }

  const extra = input.hasExtraFraction && scale.extraFractionOverDays !== null ? 1 : 0;
  const twelfths = Math.min(12, Math.max(0, input.serviceMonths) + extra);
  return {
    baseDays: base,
    entitlementDays: round2((base / 12) * twelfths),
    prorated: true,
    twelfths,
    tier,
  };
}

/**
 * Antigüedad en años cumplidos a una fecha de corte.
 * Equivale al cálculo inline que hoy hace `vacation-status`, pero sin depender de la zona
 * horaria del servidor: ambas fechas se interpretan como fechas civiles, no instantes.
 */
export function completedYearsBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return Math.max(0, years);
}
