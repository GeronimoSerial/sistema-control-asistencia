/**
 * Lectura de las reglas de ausencia desde la base.
 *
 * Cierra el circuito: el catálogo deja de ser un array en `lib/migrations.ts` y pasa a ser un
 * dato por organización que el módulo de administración puede editar, y que el evaluador de
 * `core/absence/quota.ts` consume tal cual.
 */

import { sql } from "@/core/platform/db";
import type { AbsenceTypeRule, QuotaWindow, OnExhausted } from "@/core/absence/quota";
import type { EntitlementScale } from "@/core/absence/entitlement";

type TypeRow = {
  id: string;
  code: string;
  name: string;
  reference: string | null;
  day_basis: string;
  category_code: string | null;
  requires_document: boolean;
  notes: string | null;
};

type TierRow = {
  absence_type_id: string;
  tier_order: number;
  label: string | null;
  window_type: string;
  window_days: number | null;
  limit_days: string | number | null;
  pay_rate: string | number;
  on_exhausted: string;
};

export type AbsenceTypeDetail = AbsenceTypeRule & {
  id: string;
  categoryCode: string | null;
  requiresDocument: boolean;
  notes: string | null;
};

export async function loadAbsenceTypes(organizationId: string): Promise<AbsenceTypeDetail[]> {
  const client = sql();
  const types = (await client`
    SELECT t.id, t.code, t.name, t.reference, t.day_basis, t.requires_document, t.notes,
           c.code AS category_code
    FROM absence_types t
    LEFT JOIN absence_categories c ON c.id = t.category_id
    WHERE t.organization_id = ${organizationId} AND t.active = TRUE
    ORDER BY c.code NULLS LAST, t.code
  `) as unknown as TypeRow[];

  if (!types.length) return [];

  const tiers = (await client`
    SELECT q.absence_type_id, q.tier_order, q.label, q.window_type, q.window_days,
           q.limit_days, q.pay_rate, q.on_exhausted
    FROM absence_quota_tiers q
    JOIN absence_types t ON t.id = q.absence_type_id
    WHERE t.organization_id = ${organizationId}
    ORDER BY q.absence_type_id, q.tier_order
  `) as unknown as TierRow[];

  const byType = new Map<string, TierRow[]>();
  for (const tier of tiers) {
    const key = String(tier.absence_type_id);
    const bucket = byType.get(key);
    if (bucket) bucket.push(tier);
    else byType.set(key, [tier]);
  }

  return types.map((type) => ({
    id: String(type.id),
    code: String(type.code),
    name: String(type.name),
    reference: type.reference,
    dayBasis: String(type.day_basis) as AbsenceTypeRule["dayBasis"],
    categoryCode: type.category_code,
    requiresDocument: Boolean(type.requires_document),
    notes: type.notes,
    tiers: (byType.get(String(type.id)) ?? []).map((tier) => ({
      order: Number(tier.tier_order),
      label: tier.label,
      window: String(tier.window_type) as QuotaWindow,
      windowDays: tier.window_days === null ? null : Number(tier.window_days),
      limitDays: tier.limit_days === null ? null : Number(tier.limit_days),
      payRate: Number(tier.pay_rate),
      onExhausted: String(tier.on_exhausted) as OnExhausted,
    })),
  }));
}

export async function loadAbsenceType(
  organizationId: string,
  code: string
): Promise<AbsenceTypeDetail | null> {
  const all = await loadAbsenceTypes(organizationId);
  return all.find((type) => type.code === code) ?? null;
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

type ScaleTierRow = {
  scale_id: string;
  from_value: string | number;
  to_value: string | number | null;
  days: string | number;
};

export async function loadEntitlementScale(
  organizationId: string,
  code: string
): Promise<EntitlementScale | null> {
  const client = sql();
  const rows = (await client`
    SELECT id, code, name, basis, proration, full_after_months, extra_fraction_over_days
    FROM entitlement_scales
    WHERE organization_id = ${organizationId} AND code = ${code}
    LIMIT 1
  `) as unknown as ScaleRow[];
  const scale = rows[0];
  if (!scale) return null;

  const tierRows = (await client`
    SELECT scale_id, from_value, to_value, days
    FROM entitlement_scale_tiers
    WHERE scale_id = ${scale.id}
    ORDER BY from_value
  `) as unknown as ScaleTierRow[];

  return {
    code: String(scale.code),
    name: String(scale.name),
    basis: String(scale.basis) as EntitlementScale["basis"],
    proration: String(scale.proration) as EntitlementScale["proration"],
    fullAfterMonths: scale.full_after_months === null ? null : Number(scale.full_after_months),
    extraFractionOverDays:
      scale.extra_fraction_over_days === null ? null : Number(scale.extra_fraction_over_days),
    tiers: tierRows.map((tier) => ({
      fromValue: Number(tier.from_value),
      toValue: tier.to_value === null ? null : Number(tier.to_value),
      days: Number(tier.days),
    })),
  };
}
