/**
 * Aplicación de un rule pack a una organización.
 *
 * Esto es lo que reemplaza al array `catalog` de `lib/migrations.ts` y a los `UPDATE` que
 * forzaban tolerancia y fecha de cómputo en cada arranque. Un pack se aplica **explícitamente**,
 * desde el alta de un organismo o desde un script, y a partir de ahí lo que manda es lo que el
 * administrador tenga configurado: nada vuelve a pisarlo.
 */

import { sql } from "@/core/platform/db";
import { validateSetting } from "@/core/config/definitions";
import type { RulePack } from "@/packs/types";

export type InstallReport = {
  settings: number;
  categories: number;
  absenceTypes: number;
  quotaTiers: number;
  scales: number;
  policies: number;
  roles: number;
  warnings: string[];
};

export async function installPack(
  organizationId: string,
  pack: RulePack,
  actor: string
): Promise<InstallReport> {
  const client = sql();
  const report: InstallReport = {
    settings: 0,
    categories: 0,
    absenceTypes: 0,
    quotaTiers: 0,
    scales: 0,
    policies: 0,
    roles: 0,
    warnings: [],
  };

  /* -------- Configuración -------- */
  for (const [key, raw] of Object.entries(pack.settings)) {
    const validation = validateSetting(key, raw);
    if (!validation.ok) {
      report.warnings.push(`${key}: ${validation.error}`);
      continue;
    }
    await client`
      INSERT INTO setting_values (organization_id, scope_type, scope_id, key, value, updated_by)
      VALUES (${organizationId}, 'ORGANIZATION', '', ${key}, ${JSON.stringify(validation.value)}::jsonb, ${actor})
      ON CONFLICT (organization_id, scope_type, scope_id, key) DO NOTHING
    `;
    report.settings += 1;
  }

  await client`
    UPDATE organizations
    SET time_zone = ${pack.organization.timeZone},
        locale = ${pack.organization.locale},
        rule_pack = ${pack.id},
        updated_at = now()
    WHERE id = ${organizationId}
  `;

  /* -------- Categorías y tipos de ausencia -------- */
  const categoryIds = new Map<string, string>();
  for (const category of pack.absenceCategories) {
    const rows = (await client`
      INSERT INTO absence_categories (organization_id, code, name)
      VALUES (${organizationId}, ${category.code}, ${category.name})
      ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `) as unknown as { id: string }[];
    categoryIds.set(category.code, String(rows[0].id));
    report.categories += 1;
  }

  for (const type of pack.absenceTypes) {
    const rows = (await client`
      INSERT INTO absence_types
        (organization_id, category_id, code, name, reference, day_basis, requires_document, notes)
      VALUES (
        ${organizationId}, ${categoryIds.get(type.categoryCode) ?? null}, ${type.code}, ${type.name},
        ${type.reference ?? null}, ${type.dayBasis}, ${type.requiresDocument ?? false}, ${type.notes ?? null}
      )
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name, reference = EXCLUDED.reference, day_basis = EXCLUDED.day_basis,
        requires_document = EXCLUDED.requires_document, notes = EXCLUDED.notes, updated_at = now()
      RETURNING id
    `) as unknown as { id: string }[];
    const typeId = String(rows[0].id);
    report.absenceTypes += 1;

    for (const tier of type.tiers) {
      await client`
        INSERT INTO absence_quota_tiers
          (absence_type_id, tier_order, label, window_type, window_days, limit_days, pay_rate, on_exhausted)
        VALUES (
          ${typeId}, ${tier.order}, ${tier.label ?? null}, ${tier.window}, ${tier.windowDays ?? null},
          ${tier.limitDays}, ${tier.payRate}, ${tier.onExhausted}
        )
        ON CONFLICT (absence_type_id, tier_order) DO UPDATE SET
          label = EXCLUDED.label, window_type = EXCLUDED.window_type, window_days = EXCLUDED.window_days,
          limit_days = EXCLUDED.limit_days, pay_rate = EXCLUDED.pay_rate, on_exhausted = EXCLUDED.on_exhausted
      `;
      report.quotaTiers += 1;
    }
  }

  /* -------- Escalas de derecho -------- */
  for (const scale of pack.entitlementScales) {
    const rows = (await client`
      INSERT INTO entitlement_scales
        (organization_id, code, name, basis, proration, full_after_months, extra_fraction_over_days)
      VALUES (
        ${organizationId}, ${scale.code}, ${scale.name}, ${scale.basis}, ${scale.proration},
        ${scale.fullAfterMonths}, ${scale.extraFractionOverDays}
      )
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name, basis = EXCLUDED.basis, proration = EXCLUDED.proration,
        full_after_months = EXCLUDED.full_after_months,
        extra_fraction_over_days = EXCLUDED.extra_fraction_over_days
      RETURNING id
    `) as unknown as { id: string }[];
    const scaleId = String(rows[0].id);
    await client`DELETE FROM entitlement_scale_tiers WHERE scale_id = ${scaleId}`;
    for (const tier of scale.tiers) {
      await client`
        INSERT INTO entitlement_scale_tiers (scale_id, from_value, to_value, days)
        VALUES (${scaleId}, ${tier.fromValue}, ${tier.toValue}, ${tier.days})
      `;
    }
    report.scales += 1;
  }

  /* -------- Políticas de asistencia -------- */
  for (const [index, policy] of pack.attendancePolicies.entries()) {
    await client`
      INSERT INTO attendance_policies (
        organization_id, code, name, lateness_tolerance_minutes, lateness_mode, count_early_exit,
        compensation_mode, auto_close_mode, auto_close_grace_minutes, movement_sequence,
        counting_start_date, is_default
      ) VALUES (
        ${organizationId}, ${policy.code}, ${policy.name}, ${policy.latenessToleranceMinutes},
        ${policy.latenessMode}, ${policy.countEarlyExit}, ${policy.compensationMode},
        ${policy.autoCloseMode}, ${policy.autoCloseGraceMinutes}, ${policy.movementSequence},
        ${policy.countingStartDate}, ${index === 0}
      )
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        lateness_tolerance_minutes = EXCLUDED.lateness_tolerance_minutes,
        lateness_mode = EXCLUDED.lateness_mode,
        count_early_exit = EXCLUDED.count_early_exit,
        compensation_mode = EXCLUDED.compensation_mode,
        auto_close_mode = EXCLUDED.auto_close_mode,
        auto_close_grace_minutes = EXCLUDED.auto_close_grace_minutes,
        movement_sequence = EXCLUDED.movement_sequence,
        counting_start_date = EXCLUDED.counting_start_date
    `;
    report.policies += 1;
  }

  /* -------- Roles -------- */
  for (const role of pack.roles) {
    const rows = (await client`
      INSERT INTO roles (organization_id, code, name, description, system)
      VALUES (${organizationId}, ${role.code}, ${role.name}, ${role.description ?? null}, TRUE)
      ON CONFLICT (organization_id, code) WHERE organization_id IS NOT NULL
      DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
      RETURNING id
    `) as unknown as { id: string }[];
    const roleId = String(rows[0].id);
    for (const permission of role.permissions) {
      await client`
        INSERT INTO role_permissions (role_id, permission_code)
        VALUES (${roleId}, ${permission})
        ON CONFLICT DO NOTHING
      `;
    }
    report.roles += 1;
  }

  return report;
}
