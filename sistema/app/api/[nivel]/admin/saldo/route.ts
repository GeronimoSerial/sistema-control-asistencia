/**
 * Saldo de un agente para un tipo de licencia.
 *
 * Lo consulta la pantalla de licencias mientras se completa el formulario, para que quien carga
 * vea el remanente antes de guardar y no después de que el sistema rechace la operación.
 */

import { NextResponse } from "next/server";
import { sessionWith } from "@/lib/session";
import { loadAbsenceTypes, consumptionFor } from "@/core/absence/repository";
import { evaluateQuota, paidDays } from "@/core/absence/quota";
import { computeDays, BASIS_LABELS } from "@/core/absence/days";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ nivel: string }> }
) {
  const { nivel } = await params;
  const session = await sessionWith(nivel, "absence.read");
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const url = new URL(request.url);
  const personId = url.searchParams.get("personId") ?? "";
  const typeCode = url.searchParams.get("typeCode") ?? "";
  const from = url.searchParams.get("desde") ?? new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get("hasta") ?? from;
  const eventKey = url.searchParams.get("evento") || null;

  const { db } = session.resolved.context;
  const type = loadAbsenceTypes(db).find((candidate) => candidate.code === typeCode);
  if (!type || !personId) {
    return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
  }

  const workingDays = (db
    .prepare(`SELECT weekday FROM person_schedules WHERE person_id = ?`)
    .all(personId) as unknown as { weekday: number }[]).map((row) => row.weekday);

  const days = computeDays({ basis: type.dayBasis, from, to, workingDays });
  const evaluation = evaluateQuota(type, consumptionFor(db, personId, type.id, from, eventKey));

  return NextResponse.json({
    type: { code: type.code, name: type.name, reference: type.reference, notes: type.notes },
    basis: BASIS_LABELS[type.dayBasis],
    daysInRange: days,
    tiers: evaluation.tiers.map((tier) => ({
      label: tier.label,
      window: tier.window,
      limitDays: tier.limitDays,
      usedDays: tier.usedDays,
      remainingDays: tier.remainingDays,
      payRate: tier.payRate,
    })),
    totalRemainingDays: evaluation.totalRemainingDays,
    excessDays: evaluation.excessDays,
    paidDays: paidDays(evaluation),
    blocked: evaluation.blocked,
    warnings: evaluation.warnings,
  });
}
