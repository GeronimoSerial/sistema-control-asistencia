/**
 * Saldo de un tipo de licencia para un agente.
 *
 * Antes este archivo contenía cuatro casos especiales escritos a mano (ART8A, ART12, ART13BIS,
 * ART8B/C), cada uno con sus números incrustados. Ahora los topes salen de `absence_quota_tiers`
 * y el cálculo lo hace `core/absence/quota.ts`, que no conoce ningún artículo.
 *
 * La respuesta mantiene exactamente las mismas claves que antes para no tocar el front.
 */

import { NextResponse } from "next/server";
import { getAdminSession, canManageLicenses } from "@/lib/auth";
import { ensureV13Schema } from "@/lib/migrations";
import { db } from "@/lib/db";
import { currentOrganizationId } from "@/core/tenancy/context";
import { loadAbsenceType } from "@/core/absence/repository";
import { evaluateQuota, type QuotaEvaluation } from "@/core/absence/quota";

/**
 * Construye el bloque `detail` con las claves que el front ya consume.
 * Se derivan del rol de cada tramo, no de su código: un organismo nuevo con otros artículos
 * obtiene el mismo formato sin que haya que tocar nada.
 */
function legacyDetail(evaluation: QuotaEvaluation): Record<string, number | null | unknown> {
  const [first, second] = evaluation.tiers;
  const detail: Record<string, number | null | unknown> = {};
  if (!first) return detail;

  detail.withPayUsed = first.usedDays;
  detail.remainingWithPay = first.remainingDays;
  // Alias históricos: el front viejo los nombraba distinto según el artículo.
  detail.baseUsed = first.usedDays;
  detail.remainingBase = first.remainingDays;
  detail.fullPayUsed = first.usedDays;
  detail.remainingFullPay = first.remainingDays;

  if (second) {
    if (second.limitDays === null) {
      // Tramo abierto: todo lo que cae acá es excedente (típicamente sin goce).
      detail.excessWithoutPay = second.usedDays;
    } else if (second.payRate === 0) {
      detail.withoutPayUsed = second.usedDays;
      detail.remainingWithoutPay = second.remainingDays;
    } else if (second.payRate === 1) {
      detail.extensionUsed = second.usedDays;
      detail.remainingExtension = second.remainingDays;
    } else {
      detail.halfPayUsed = second.usedDays;
      detail.remainingHalfPay = second.remainingDays;
    }
    detail.excess = evaluation.excessDays;
  }

  detail.tiers = evaluation.tiers;
  detail.warnings = evaluation.warnings;
  detail.blocked = evaluation.blocked;
  return detail;
}

/** Suma de los topes finitos de una ventana. `null` si esa ventana no tiene tope. */
function windowLimit(evaluation: QuotaEvaluation, window: string): number | null {
  const limits = evaluation.tiers
    .filter((tier) => tier.window === window && tier.limitDays !== null)
    .map((tier) => tier.limitDays as number);
  return limits.length ? limits.reduce((a, b) => a + b, 0) : null;
}

export async function GET(req: Request) {
  await ensureV13Schema();
  const session = await getAdminSession();
  if (!canManageLicenses(session)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(req.url);
  const employeeId = url.searchParams.get("employeeId") || "";
  const typeId = Number(url.searchParams.get("leaveTypeId"));
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  if (!employeeId || !Number.isInteger(typeId)) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const sql = db();
  const type = (
    await sql`SELECT id, code, name, article, annual_limit, monthly_limit, event_limit, extension_limit
              FROM leave_types WHERE id=${typeId}`
  )[0];
  if (!type) return NextResponse.json({ error: "Tipo inexistente" }, { status: 404 });

  const year = Number(date.slice(0, 4));
  const yearMonth = date.slice(0, 7);

  const annualRow = (
    await sql`SELECT COALESCE(SUM(computed_days),0)::int used FROM leave_records
              WHERE employee_id=${employeeId} AND leave_type_id=${typeId} AND active=TRUE
                AND EXTRACT(YEAR FROM date_from)=${year}`
  )[0];
  const monthlyRow = (
    await sql`SELECT COALESCE(SUM(computed_days),0)::int used FROM leave_records
              WHERE employee_id=${employeeId} AND leave_type_id=${typeId} AND active=TRUE
                AND to_char(date_from,'YYYY-MM')=${yearMonth}`
  )[0];
  const used = Number(annualRow.used || 0);
  const monthUsed = Number(monthlyRow.used || 0);

  const organizationId = await currentOrganizationId();
  const rule = organizationId ? await loadAbsenceType(organizationId, String(type.code)) : null;

  if (!rule || !rule.tiers.length) {
    // El organismo todavía no fue instalado: se responde con los topes planos del catálogo viejo.
    return NextResponse.json({
      code: String(type.code),
      name: type.name,
      article: type.article,
      annualUsed: used,
      annualLimit: type.annual_limit ? Number(type.annual_limit) : null,
      annualRemaining: type.annual_limit ? Math.max(Number(type.annual_limit) - used, 0) : null,
      annualExcess: type.annual_limit ? Math.max(used - Number(type.annual_limit), 0) : 0,
      monthlyUsed: monthUsed,
      monthlyLimit: type.monthly_limit ? Number(type.monthly_limit) : null,
      monthlyRemaining: type.monthly_limit
        ? Math.max(Number(type.monthly_limit) - monthUsed, 0)
        : null,
      monthlyExcess: type.monthly_limit
        ? Math.max(monthUsed - Number(type.monthly_limit), 0)
        : 0,
      eventLimit: type.event_limit ? Number(type.event_limit) : null,
      extensionLimit: type.extension_limit ? Number(type.extension_limit) : null,
      detail: {},
      source: "LEGACY",
    });
  }

  // `leave_records` todavía no identifica el hecho que origina la licencia (un embarazo, un
  // accidente), así que las ventanas EVENT y ROLLING se alimentan con el acumulado anual, que es
  // lo que el sistema venía usando. Cuando los registros tengan identificador de evento, sólo
  // cambia este objeto.
  const evaluation = evaluateQuota(rule, {
    annual: used,
    monthly: monthUsed,
    event: used,
    rolling: used,
    lifetime: used,
  });

  // La ventana del primer tramo manda: es la que define el tope "principal" que muestra el front.
  const primaryWindow = evaluation.tiers[0].window;
  const primaryLimit = windowLimit(evaluation, primaryWindow);
  const monthlyLimit = windowLimit(evaluation, "MONTHLY");

  return NextResponse.json({
    code: rule.code,
    name: rule.name,
    article: rule.reference,
    annualUsed: used,
    annualLimit: primaryLimit,
    annualRemaining: primaryLimit === null ? null : Math.max(primaryLimit - used, 0),
    annualExcess: primaryLimit === null ? 0 : Math.max(used - primaryLimit, 0),
    monthlyUsed: monthUsed,
    monthlyLimit,
    monthlyRemaining: monthlyLimit === null ? null : Math.max(monthlyLimit - monthUsed, 0),
    monthlyExcess: monthlyLimit === null ? 0 : Math.max(monthUsed - monthlyLimit, 0),
    eventLimit: windowLimit(evaluation, "EVENT"),
    extensionLimit: evaluation.tiers[1]?.limitDays ?? null,
    detail: legacyDetail(evaluation),
    source: "RULES",
  });
}
