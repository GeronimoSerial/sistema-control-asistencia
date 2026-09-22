/**
 * Aplicación de un paquete de reglas a la base de un nivel.
 *
 * El paquete trae, como datos, lo que en el sistema anterior estaba escrito en el código: la
 * marca, el catálogo de ausencias con sus cuotas por tramos, las escalas de derecho, la política
 * de asistencia y los roles iniciales.
 *
 * Es idempotente y **no pisa lo que el administrador haya cambiado**: la configuración se inserta
 * sólo si no existe. Ese fue uno de los errores del sistema anterior, donde una migración forzaba
 * la tolerancia en cada arranque y revertía los cambios hechos desde la pantalla.
 *
 * No importa nada en tiempo de ejecución: recibe la base por parámetro. Así se puede probar
 * contra una base en memoria sin levantar la aplicación.
 */

import type { DatabaseSync } from "node:sqlite";
import type { RulePack } from "./types";

type Db = DatabaseSync;

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

export function installPack(db: Db, pack: RulePack, actor: string): InstallReport {
  const now = new Date().toISOString();
  const report: InstallReport = {
    settings: 0, categories: 0, absenceTypes: 0, quotaTiers: 0,
    scales: 0, policies: 0, roles: 0, warnings: [],
  };

  /* -------- Configuración -------- */
  const insertSetting = db.prepare(
    `INSERT INTO settings (scope_type, scope_id, key, value, updated_by, updated_at)
     VALUES ('LEVEL', '', ?, ?, ?, ?)
     ON CONFLICT(scope_type, scope_id, key) DO NOTHING`
  );
  for (const [key, value] of Object.entries(pack.settings)) {
    insertSetting.run(key, JSON.stringify(value), actor, now);
    report.settings += 1;
  }

  /* -------- Categorías -------- */
  const categoryIds = new Map<string, string>();
  const insertCategory = db.prepare(
    `INSERT INTO absence_categories (id, code, name) VALUES (?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name`
  );
  const selectCategory = db.prepare(`SELECT id FROM absence_categories WHERE code = ?`);
  for (const category of pack.absenceCategories) {
    insertCategory.run(crypto.randomUUID(), category.code, category.name);
    const row = selectCategory.get(category.code) as unknown as { id: string };
    categoryIds.set(category.code, row.id);
    report.categories += 1;
  }

  /* -------- Tipos de ausencia y sus tramos de cuota -------- */
  const insertType = db.prepare(
    `INSERT INTO absence_types
       (id, category_id, code, name, reference, day_basis, requires_document, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       category_id = excluded.category_id, name = excluded.name, reference = excluded.reference,
       day_basis = excluded.day_basis, requires_document = excluded.requires_document,
       notes = excluded.notes, updated_at = excluded.updated_at`
  );
  const selectType = db.prepare(`SELECT id FROM absence_types WHERE code = ?`);
  const insertTier = db.prepare(
    `INSERT INTO absence_quota_tiers
       (id, absence_type_id, tier_order, label, window_type, window_days, limit_days, pay_rate, on_exhausted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(absence_type_id, tier_order) DO UPDATE SET
       label = excluded.label, window_type = excluded.window_type, window_days = excluded.window_days,
       limit_days = excluded.limit_days, pay_rate = excluded.pay_rate, on_exhausted = excluded.on_exhausted`
  );

  for (const type of pack.absenceTypes) {
    insertType.run(
      crypto.randomUUID(),
      categoryIds.get(type.categoryCode) ?? null,
      type.code, type.name, type.reference ?? null, type.dayBasis,
      type.requiresDocument ? 1 : 0, type.notes ?? null, now, now
    );
    const typeId = (selectType.get(type.code) as unknown as { id: string }).id;
    report.absenceTypes += 1;

    for (const tier of type.tiers) {
      insertTier.run(
        crypto.randomUUID(), typeId, tier.order, tier.label ?? null, tier.window,
        tier.windowDays ?? null, tier.limitDays, tier.payRate, tier.onExhausted
      );
      report.quotaTiers += 1;
    }
  }

  /* -------- Escalas de derecho -------- */
  const insertScale = db.prepare(
    `INSERT INTO entitlement_scales
       (id, code, name, basis, proration, full_after_months, extra_fraction_over_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       name = excluded.name, basis = excluded.basis, proration = excluded.proration,
       full_after_months = excluded.full_after_months,
       extra_fraction_over_days = excluded.extra_fraction_over_days`
  );
  const selectScale = db.prepare(`SELECT id FROM entitlement_scales WHERE code = ?`);
  const deleteScaleTiers = db.prepare(`DELETE FROM entitlement_scale_tiers WHERE scale_id = ?`);
  const insertScaleTier = db.prepare(
    `INSERT INTO entitlement_scale_tiers (id, scale_id, from_value, to_value, days) VALUES (?, ?, ?, ?, ?)`
  );

  for (const scale of pack.entitlementScales) {
    insertScale.run(
      crypto.randomUUID(), scale.code, scale.name, scale.basis, scale.proration,
      scale.fullAfterMonths, scale.extraFractionOverDays
    );
    const scaleId = (selectScale.get(scale.code) as unknown as { id: string }).id;
    deleteScaleTiers.run(scaleId);
    for (const tier of scale.tiers) {
      insertScaleTier.run(crypto.randomUUID(), scaleId, tier.fromValue, tier.toValue, tier.days);
    }
    report.scales += 1;
  }

  /* -------- Políticas de asistencia -------- */
  const insertPolicy = db.prepare(
    `INSERT INTO attendance_policies
       (id, code, name, lateness_tolerance_minutes, lateness_mode, count_early_exit,
        compensation_mode, auto_close_mode, auto_close_grace_minutes, movement_sequence,
        counting_start_date, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       name = excluded.name,
       lateness_tolerance_minutes = excluded.lateness_tolerance_minutes,
       lateness_mode = excluded.lateness_mode,
       count_early_exit = excluded.count_early_exit,
       compensation_mode = excluded.compensation_mode,
       auto_close_mode = excluded.auto_close_mode,
       auto_close_grace_minutes = excluded.auto_close_grace_minutes,
       movement_sequence = excluded.movement_sequence,
       counting_start_date = excluded.counting_start_date`
  );
  for (const [index, policy] of pack.attendancePolicies.entries()) {
    insertPolicy.run(
      crypto.randomUUID(), policy.code, policy.name, policy.latenessToleranceMinutes,
      policy.latenessMode, policy.countEarlyExit ? 1 : 0, policy.compensationMode,
      policy.autoCloseMode, policy.autoCloseGraceMinutes, policy.movementSequence,
      policy.countingStartDate, index === 0 ? 1 : 0
    );
    report.policies += 1;
  }

  /* -------- Roles -------- */
  const insertRole = db.prepare(
    `INSERT INTO roles (id, code, name, description, system, created_at) VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description`
  );
  const selectRole = db.prepare(`SELECT id FROM roles WHERE code = ?`);
  const insertRolePermission = db.prepare(
    `INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?) ON CONFLICT DO NOTHING`
  );
  const knownPermission = db.prepare(`SELECT code FROM permissions WHERE code = ?`);

  for (const role of pack.roles) {
    insertRole.run(crypto.randomUUID(), role.code, role.name, role.description ?? null, now);
    const roleId = (selectRole.get(role.code) as unknown as { id: string }).id;
    for (const permission of role.permissions) {
      if (!knownPermission.get(permission)) {
        report.warnings.push(`El rol ${role.code} pide un permiso inexistente: ${permission}`);
        continue;
      }
      insertRolePermission.run(roleId, permission);
    }
    report.roles += 1;
  }

  return report;
}
