"use server";

import { revalidatePath } from "next/cache";
import { sessionWith } from "@/lib/session";
import { loadEntitlementScale } from "@/core/absence/repository";
import { evaluateEntitlement } from "@/core/absence/entitlement";
import { type ActionState, SCALE_CODE } from "./shared";

function fail(error: string): ActionState {
  return { error, message: null };
}

/**
 * Calcula y guarda el derecho anual de un agente.
 *
 * El número no se escribe a mano: sale de la escala del nivel, que es un dato editable. En el
 * sistema anterior la escala 20/25/30/35 y el proporcional por doceavos estaban en el código de
 * la propia ruta.
 */
export async function guardarDerecho(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "absence.write");
  if (!session) return fail("No tenés permiso para definir el derecho de vacaciones.");

  const personId = String(formData.get("personId") ?? "");
  const year = Number(formData.get("anio"));
  const antiguedad = Number(formData.get("antiguedad"));
  const meses = Number(formData.get("meses"));
  const fraccion = formData.get("fraccion") === "on";
  const notas = String(formData.get("notas") ?? "").trim().slice(0, 500);

  if (!personId) return fail("Elegí un agente.");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail("El año no es válido.");
  if (!Number.isInteger(antiguedad) || antiguedad < 0 || antiguedad > 60) {
    return fail("La antigüedad debe estar entre 0 y 60 años.");
  }
  if (!Number.isInteger(meses) || meses < 0 || meses > 12) {
    return fail("Los meses de servicio deben estar entre 0 y 12.");
  }

  const { db } = session.resolved.context;
  const scale = loadEntitlementScale(db, SCALE_CODE);
  if (!scale) return fail("El nivel no tiene cargada una escala de vacaciones.");

  const result = evaluateEntitlement(scale, {
    basisValue: antiguedad,
    serviceMonths: meses,
    hasExtraFraction: fraccion,
  });
  if (!result.tier) {
    return fail(`La escala no cubre una antigüedad de ${antiguedad} años.`);
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO entitlements
       (id, person_id, scale_code, benefit_year, basis_value, service_months, extra_fraction,
        entitlement_days, notes, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(person_id, scale_code, benefit_year) DO UPDATE SET
       basis_value = excluded.basis_value, service_months = excluded.service_months,
       extra_fraction = excluded.extra_fraction, entitlement_days = excluded.entitlement_days,
       notes = excluded.notes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(
    crypto.randomUUID(), personId, SCALE_CODE, year, antiguedad, meses,
    fraccion ? 1 : 0, result.entitlementDays, notas || null, session.user.email, now
  );

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, new_value, created_at)
     VALUES (?, 'SET_ENTITLEMENT', 'person', ?, ?, ?)`
  ).run(
    session.user.email, personId,
    JSON.stringify({ year, antiguedad, meses, fraccion, dias: result.entitlementDays }), now
  );

  revalidatePath(`/${nivel}/admin/vacaciones`);
  return {
    error: null,
    message: result.prorated
      ? `Derecho ${year}: ${result.entitlementDays} días — proporcional de ${result.twelfths}/12 sobre ${result.baseDays}.`
      : `Derecho ${year}: ${result.entitlementDays} días.`,
  };
}
