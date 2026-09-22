/**
 * Lectura de reglas y consumo de ausencias desde la base de un nivel.
 *
 * Alimenta al evaluador de `quota.ts` y a las escalas de `entitlement.ts`. Ninguno de los dos
 * conoce la base: reciben datos ya armados, y por eso se pueden verificar sin levantar nada.
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  AbsenceTypeRule,
  ConsumptionByWindow,
  OnExhausted,
  QuotaWindow,
} from "./quota";
import type { EntitlementScale } from "./entitlement";

type Db = DatabaseSync;

export type AbsenceTypeDetail = AbsenceTypeRule & {
  id: string;
  categoryCode: string | null;
  requiresDocument: boolean;
  notes: string | null;
};

type TypeRow = {
  id: string;
  code: string;
  name: string;
  reference: string | null;
  day_basis: string;
  requires_document: number;
  notes: string | null;
  category_code: string | null;
};

type TierRow = {
  absence_type_id: string;
  tier_order: number;
  label: string | null;
  window_type: string;
  window_days: number | null;
  limit_days: number | null;
  pay_rate: number;
  on_exhausted: string;
};

export function loadAbsenceTypes(db: Db): AbsenceTypeDetail[] {
  const types = db
    .prepare(
      `SELECT t.id, t.code, t.name, t.reference, t.day_basis, t.requires_document, t.notes,
              c.code AS category_code
       FROM absence_types t
       LEFT JOIN absence_categories c ON c.id = t.category_id
       WHERE t.active = 1
       ORDER BY c.code, t.code`
    )
    .all() as unknown as TypeRow[];
  if (!types.length) return [];

  const tiers = db
    .prepare(
      `SELECT absence_type_id, tier_order, label, window_type, window_days,
              limit_days, pay_rate, on_exhausted
       FROM absence_quota_tiers
       ORDER BY absence_type_id, tier_order`
    )
    .all() as unknown as TierRow[];

  const byType = new Map<string, TierRow[]>();
  for (const tier of tiers) {
    const bucket = byType.get(tier.absence_type_id);
    if (bucket) bucket.push(tier);
    else byType.set(tier.absence_type_id, [tier]);
  }

  return types.map((type) => ({
    id: type.id,
    code: type.code,
    name: type.name,
    reference: type.reference,
    dayBasis: type.day_basis as AbsenceTypeRule["dayBasis"],
    categoryCode: type.category_code,
    requiresDocument: type.requires_document === 1,
    notes: type.notes,
    tiers: (byType.get(type.id) ?? []).map((tier) => ({
      order: tier.tier_order,
      label: tier.label,
      window: tier.window_type as QuotaWindow,
      windowDays: tier.window_days,
      limitDays: tier.limit_days,
      payRate: tier.pay_rate,
      onExhausted: tier.on_exhausted as OnExhausted,
    })),
  }));
}

export function loadAbsenceTypeByCode(db: Db, code: string): AbsenceTypeDetail | null {
  return loadAbsenceTypes(db).find((type) => type.code === code) ?? null;
}

/**
 * Días ya consumidos por una persona para un tipo, en cada ventana de cómputo.
 *
 * `eventKey` identifica el hecho concreto —un embarazo, un accidente— y es lo que permite que la
 * ventana EVENT se calcule de verdad. El sistema anterior no tenía ese dato y usaba el acumulado
 * anual para todo, lo que hacía que un Art. 8 inc. b que cruzaba el año se reiniciara solo.
 */
export function consumptionFor(
  db: Db,
  personId: string,
  absenceTypeId: string,
  referenceDate: string,
  eventKey?: string | null
): ConsumptionByWindow {
  const year = referenceDate.slice(0, 4);
  const yearMonth = referenceDate.slice(0, 7);

  const sum = (sql: string, params: unknown[]): number => {
    const row = db.prepare(sql).get(...(params as never[])) as unknown as { total: number | null };
    return Number(row?.total ?? 0);
  };

  const base = `FROM absence_records WHERE person_id = ? AND absence_type_id = ? AND active = 1`;

  const annual = sum(
    `SELECT COALESCE(SUM(computed_days), 0) AS total ${base} AND substr(date_from, 1, 4) = ?`,
    [personId, absenceTypeId, year]
  );
  const monthly = sum(
    `SELECT COALESCE(SUM(computed_days), 0) AS total ${base} AND substr(date_from, 1, 7) = ?`,
    [personId, absenceTypeId, yearMonth]
  );
  const lifetime = sum(
    `SELECT COALESCE(SUM(computed_days), 0) AS total ${base}`,
    [personId, absenceTypeId]
  );
  const event = eventKey
    ? sum(`SELECT COALESCE(SUM(computed_days), 0) AS total ${base} AND event_key = ?`, [
        personId,
        absenceTypeId,
        eventKey,
      ])
    : 0;

  return { annual, monthly, event, rolling: annual, lifetime };
}

type ScaleRow = {
  id: string;
  code: string;
  name: string;
  basis: string;
  proration: string;
  full_after_months: number | null;
  extra_fraction_over_days: number | null;
};

export function loadEntitlementScale(db: Db, code: string): EntitlementScale | null {
  const scale = db
    .prepare(`SELECT * FROM entitlement_scales WHERE code = ?`)
    .get(code) as unknown as ScaleRow | undefined;
  if (!scale) return null;

  const tiers = db
    .prepare(
      `SELECT from_value, to_value, days FROM entitlement_scale_tiers
       WHERE scale_id = ? ORDER BY from_value`
    )
    .all(scale.id) as unknown as { from_value: number; to_value: number | null; days: number }[];

  return {
    code: scale.code,
    name: scale.name,
    basis: scale.basis as EntitlementScale["basis"],
    proration: scale.proration as EntitlementScale["proration"],
    fullAfterMonths: scale.full_after_months,
    extraFractionOverDays: scale.extra_fraction_over_days,
    tiers: tiers.map((tier) => ({
      fromValue: tier.from_value,
      toValue: tier.to_value,
      days: tier.days,
    })),
  };
}
