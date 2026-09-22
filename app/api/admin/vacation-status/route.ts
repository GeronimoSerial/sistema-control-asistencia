/**
 * Derecho y saldo de vacaciones de un agente para un año.
 *
 * La escala 20/25/30/35 y el proporcional por doceavos dejaron de estar escritos acá: salen de
 * `entitlement_scales` y las calcula `core/absence/entitlement.ts`. Mientras un organismo no
 * tenga su escala cargada se usa la fórmula anterior, para no cambiar números a mitad de camino.
 */

import { NextResponse } from "next/server";
import { getAdminSession, canManageLicenses } from "@/lib/auth";
import { ensureV13Schema } from "@/lib/migrations";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { currentOrganizationId } from "@/core/tenancy/context";
import { loadEntitlementScale } from "@/core/absence/repository";
import {
  evaluateEntitlement,
  completedYearsBetween,
  type EntitlementScale,
} from "@/core/absence/entitlement";

const SCALE_CODE = "VACATION";

/** Fórmula anterior al refactor. Se conserva como respaldo mientras dure la transición. */
function legacyEntitlement(years: number, months: number, extra: boolean) {
  const base = years <= 5 ? 20 : years <= 10 ? 25 : years <= 15 ? 30 : 35;
  if (months >= 6) return base;
  const units = Math.min(12, Math.max(0, months) + (extra ? 1 : 0));
  return Math.round(((base / 12) * units) * 100) / 100;
}

async function resolveScale(): Promise<EntitlementScale | null> {
  const organizationId = await currentOrganizationId();
  if (!organizationId) return null;
  try {
    return await loadEntitlementScale(organizationId, SCALE_CODE);
  } catch {
    return null;
  }
}

function computeDays(
  scale: EntitlementScale | null,
  years: number,
  months: number,
  extra: boolean
): number {
  if (!scale || !scale.tiers.length) return legacyEntitlement(years, months, extra);
  return evaluateEntitlement(scale, {
    basisValue: years,
    serviceMonths: months,
    hasExtraFraction: extra,
  }).entitlementDays;
}

export async function GET(req: Request) {
  await ensureV13Schema();
  const session = await getAdminSession();
  if (!canManageLicenses(session)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(req.url);
  const employeeId = url.searchParams.get("employeeId") || "";
  const year = Number(url.searchParams.get("year"));
  if (!employeeId || !Number.isInteger(year)) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const sql = db();
  const profile =
    (
      await sql`SELECT * FROM vacation_entitlements
                WHERE employee_id=${employeeId} AND benefit_year=${year}`
    )[0] || null;

  const employee =
    (await sql`SELECT seniority_date::text FROM employees WHERE id=${employeeId}`)[0] || null;

  // Antigüedad de referencia al 31 de diciembre del año del beneficio.
  const seniorityReference = employee?.seniority_date
    ? completedYearsBetween(String(employee.seniority_date).slice(0, 10), `${year}-12-31`)
    : null;

  const usedRow = (
    await sql`SELECT COALESCE(SUM(computed_days),0)::int used FROM leave_records
              WHERE employee_id=${employeeId} AND leave_type='VACATION' AND active=TRUE
                AND EXTRACT(YEAR FROM date_from)=${year}`
  )[0];
  const usedDays = Number(usedRow.used || 0);
  const entitlementDays = profile ? Number(profile.entitlement_days) : null;

  return NextResponse.json({
    profile,
    seniorityReference,
    usedDays,
    entitlementDays,
    balance:
      entitlementDays === null ? null : Math.round((entitlementDays - usedDays) * 100) / 100,
    excess:
      entitlementDays === null
        ? null
        : Math.max(Math.round((usedDays - entitlementDays) * 100) / 100, 0),
  });
}

export async function POST(req: Request) {
  await ensureV13Schema();
  const session = await getAdminSession();
  if (!canManageLicenses(session)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const employeeId = String(body.employeeId || "");
  const year = Number(body.year);
  const seniority = Number(body.seniorityYears);
  const months = Number(body.serviceMonths);
  const extra = Boolean(body.extraFractionOver15);
  const notes = String(body.notes || "").slice(0, 500);

  if (
    !employeeId ||
    !Number.isInteger(year) || year < 2020 || year > 2100 ||
    !Number.isInteger(seniority) || seniority < 0 || seniority > 60 ||
    !Number.isInteger(months) || months < 0 || months > 12
  ) {
    return NextResponse.json({ error: "Datos de vacaciones inválidos" }, { status: 400 });
  }

  const scale = await resolveScale();
  const days = computeDays(scale, seniority, months, extra);

  const sql = db();
  await sql`
    INSERT INTO vacation_entitlements(
      employee_id, benefit_year, seniority_years, service_months,
      extra_fraction_over_15, entitlement_days, notes, updated_by
    ) VALUES (
      ${employeeId}, ${year}, ${seniority}, ${months}, ${extra}, ${days},
      ${notes || null}, ${session!.email}
    )
    ON CONFLICT(employee_id, benefit_year) DO UPDATE SET
      seniority_years = EXCLUDED.seniority_years,
      service_months = EXCLUDED.service_months,
      extra_fraction_over_15 = EXCLUDED.extra_fraction_over_15,
      entitlement_days = EXCLUDED.entitlement_days,
      notes = EXCLUDED.notes,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `;

  await writeAudit({
    actor: session!.email,
    action: "SET_VACATION_ENTITLEMENT",
    entityType: "vacation_entitlement",
    entityId: `${employeeId}:${year}`,
    next: { seniority, months, extra, days, scale: scale?.code ?? "LEGACY" },
  });

  return NextResponse.json({ ok: true, entitlementDays: days, source: scale ? "RULES" : "LEGACY" });
}
