/**
 * Evaluador de cuotas de ausencia.
 *
 * Reemplaza los casos especiales por código que hoy viven en
 * `app/api/admin/leave-balance/route.ts`:
 *
 *   if (code === "ART8A")    detail = { withPayUsed: Math.min(used, 30), ... }
 *   if (code === "ART12")    detail = { ..., remainingWithoutPay: Math.max(40 - ..., 0) }
 *   if (code === "ART13BIS") detail = { baseUsed: Math.min(used, 15), ... }
 *   if (code === "ART8B" || code === "ART8C") detail = { fullPayUsed: Math.min(used, 730), ... }
 *
 * Los cuatro son el mismo patrón: tramos consecutivos de cuota, cada uno con su ventana de
 * cómputo, su límite, su tasa de pago y qué hacer al agotarse. Expresados como datos, el núcleo
 * no necesita conocer ningún artículo ni ninguna legislación.
 */

/** Ventana sobre la que se acumula el consumo de un tramo. */
export type QuotaWindow =
  /** Año calendario. */
  | "ANNUAL"
  /** Mes calendario. */
  | "MONTHLY"
  /** El hecho concreto: un embarazo, un accidente, un duelo. */
  | "EVENT"
  /** Ventana móvil de `windowDays` hacia atrás desde la fecha evaluada. */
  | "ROLLING"
  /** Toda la carrera del agente. */
  | "LIFETIME";

/** Qué ocurre cuando el tramo se agota. */
export type OnExhausted =
  /** El excedente pasa al tramo siguiente. */
  | "SPILL"
  /** Se permite, con advertencia. */
  | "WARN"
  /** No se permite cargar más. */
  | "BLOCK";

export type QuotaTier = {
  order: number;
  window: QuotaWindow;
  /** Sólo para `ROLLING`. */
  windowDays?: number | null;
  /** `null` = sin límite. */
  limitDays: number | null;
  /** 1 = 100 %, 0.5 = 50 %, 0 = sin goce de haberes. */
  payRate: number;
  onExhausted: OnExhausted;
  label?: string | null;
};

export type AbsenceTypeRule = {
  code: string;
  name: string;
  /** Texto libre de referencia normativa. El núcleo no lo interpreta. */
  reference?: string | null;
  dayBasis: "CALENDAR" | "BUSINESS" | "SCHEDULED" | "MANUAL";
  tiers: QuotaTier[];
};

/** Días ya consumidos, por ventana. Los provee la capa de datos. */
export type ConsumptionByWindow = {
  annual?: number;
  monthly?: number;
  event?: number;
  rolling?: number;
  lifetime?: number;
};

export type TierBalance = {
  order: number;
  label: string | null;
  window: QuotaWindow;
  limitDays: number | null;
  payRate: number;
  /** Días imputados a este tramo. */
  usedDays: number;
  /** Días que todavía caben. `null` si el tramo no tiene límite. */
  remainingDays: number | null;
  exhausted: boolean;
};

export type QuotaEvaluation = {
  code: string;
  name: string;
  reference: string | null;
  tiers: TierBalance[];
  /** Días consumidos por encima del último tramo con límite. */
  excessDays: number;
  /** Días que todavía se pueden cargar sin caer en excedente. `null` si no hay tope. */
  totalRemainingDays: number | null;
  /** `true` si hay días por encima de un tramo que no admite excedente. */
  blocked: boolean;
  warnings: string[];
};

function consumedFor(window: QuotaWindow, consumption: ConsumptionByWindow): number {
  switch (window) {
    case "ANNUAL":
      return consumption.annual ?? 0;
    case "MONTHLY":
      return consumption.monthly ?? 0;
    case "EVENT":
      return consumption.event ?? 0;
    case "ROLLING":
      return consumption.rolling ?? 0;
    case "LIFETIME":
      return consumption.lifetime ?? 0;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Reparte el consumo entre los tramos, en orden, y devuelve el desglose.
 *
 * Los tramos que comparten ventana se consumen en cascada: el primero absorbe hasta su límite y
 * el excedente cae en el siguiente. Un tramo con una ventana distinta (por ejemplo un tope
 * mensual junto a uno anual) se evalúa contra su propio acumulado, no contra el remanente.
 */
export function evaluateQuota(
  rule: AbsenceTypeRule,
  consumption: ConsumptionByWindow
): QuotaEvaluation {
  const ordered = [...rule.tiers].sort((a, b) => a.order - b.order);
  const balances: TierBalance[] = [];
  const warnings: string[] = [];
  let blocked = false;

  // Consumo pendiente de imputar, por ventana. Cada ventana cae en cascada por separado.
  const pending: Record<QuotaWindow, number> = {
    ANNUAL: consumedFor("ANNUAL", consumption),
    MONTHLY: consumedFor("MONTHLY", consumption),
    EVENT: consumedFor("EVENT", consumption),
    ROLLING: consumedFor("ROLLING", consumption),
    LIFETIME: consumedFor("LIFETIME", consumption),
  };

  for (const tier of ordered) {
    const available = pending[tier.window];
    const used = tier.limitDays === null ? available : Math.min(available, tier.limitDays);
    pending[tier.window] = round2(Math.max(0, available - used));

    const remaining = tier.limitDays === null ? null : round2(Math.max(0, tier.limitDays - used));
    const exhausted = tier.limitDays !== null && used >= tier.limitDays;

    // Bloquea el consumo que **excede** el tramo, no el que lo agota justo: registrar
    // exactamente los días que quedaban es válido. Lo que no se admite es el sobrante, que en un
    // tramo BLOCK no tiene adónde pasar.
    if (tier.onExhausted === "BLOCK" && pending[tier.window] > 0) blocked = true;
    if (exhausted && tier.onExhausted === "WARN") {
      warnings.push(
        `${tier.label ?? rule.name}: tramo agotado (${tier.limitDays} días). Requiere autorización.`
      );
    }

    balances.push({
      order: tier.order,
      label: tier.label ?? null,
      window: tier.window,
      limitDays: tier.limitDays,
      payRate: tier.payRate,
      usedDays: round2(used),
      remainingDays: remaining,
      exhausted,
    });
  }

  // Un tipo puede tener topes en más de una ventana a la vez (por ejemplo 6 días al año y no
  // más de 2 por mes). Cada ventana se cierra por separado; manda la más restrictiva.
  const limitedWindows = Array.from(
    new Set(ordered.filter((t) => t.limitDays !== null).map((t) => t.window))
  );
  const unlimitedWindows = new Set(
    ordered.filter((t) => t.limitDays === null).map((t) => t.window)
  );

  // Excedente: lo que quedó sin imputar en la ventana que primero se desbordó.
  const excessDays = limitedWindows.reduce(
    (worst, window) => Math.max(worst, unlimitedWindows.has(window) ? 0 : pending[window]),
    0
  );

  const remainingPerWindow = limitedWindows
    .filter((window) => !unlimitedWindows.has(window))
    .map((window) =>
      round2(
        balances
          .filter((b) => b.window === window)
          .reduce((acc, b) => acc + (b.remainingDays ?? 0), 0)
      )
    );
  const totalRemainingDays = remainingPerWindow.length ? Math.min(...remainingPerWindow) : null;

  if (excessDays > 0) {
    warnings.push(`Se registran ${excessDays} días por encima del máximo previsto.`);
  }

  return {
    code: rule.code,
    name: rule.name,
    reference: rule.reference ?? null,
    tiers: balances,
    excessDays: round2(excessDays),
    totalRemainingDays,
    blocked,
    warnings,
  };
}

/**
 * Días efectivamente remunerados según el reparto por tramos.
 * Un tramo con `payRate` 0.5 aporta la mitad de sus días imputados.
 */
export function paidDays(evaluation: QuotaEvaluation): number {
  return round2(evaluation.tiers.reduce((acc, t) => acc + t.usedDays * t.payRate, 0));
}

/** Verifica si una carga de `days` días adicionales es admisible. */
export function canRegister(
  rule: AbsenceTypeRule,
  consumption: ConsumptionByWindow,
  days: number
): { allowed: boolean; reason: string | null; evaluation: QuotaEvaluation } {
  const current = evaluateQuota(rule, consumption);
  if (current.blocked) {
    return { allowed: false, reason: "QUOTA_EXHAUSTED", evaluation: current };
  }
  const projected = evaluateQuota(rule, {
    annual: (consumption.annual ?? 0) + days,
    monthly: (consumption.monthly ?? 0) + days,
    event: (consumption.event ?? 0) + days,
    rolling: (consumption.rolling ?? 0) + days,
    lifetime: (consumption.lifetime ?? 0) + days,
  });
  if (projected.blocked) {
    return { allowed: false, reason: "WOULD_EXCEED_QUOTA", evaluation: projected };
  }
  return { allowed: true, reason: null, evaluation: projected };
}
