import { redirect } from "next/navigation";
import { sessionWith } from "@/lib/session";
import { loadAbsenceTypes } from "@/core/absence/repository";
import LicenciasPanel, { type AbsenceRow, type Option, type TypeOption } from "./LicenciasPanel";

export const dynamic = "force-dynamic";

export default async function LicenciasPage({
  params,
}: {
  params: Promise<{ nivel: string }>;
}) {
  const { nivel } = await params;
  const session = await sessionWith(nivel, "absence.read");
  if (!session) redirect(`/${nivel}/ingresar`);

  const { db } = session.resolved.context;

  const people = db
    .prepare(
      `SELECT id, last_name || ', ' || first_name AS label, national_id
       FROM people WHERE active = 1 ORDER BY last_name, first_name`
    )
    .all() as unknown as Option[];

  const types: TypeOption[] = loadAbsenceTypes(db).map((type) => ({
    code: type.code,
    name: type.name,
    // `reference` es opcional en la regla; la pantalla la trata siempre como texto o nada.
    reference: type.reference ?? null,
    categoryCode: type.categoryCode,
    requiresDocument: type.requiresDocument,
    hasEventWindow: type.tiers.some((tier) => tier.window === "EVENT"),
    manual: type.dayBasis === "MANUAL",
  }));

  const rows = db
    .prepare(
      `SELECT r.id, r.date_from, r.date_to, r.computed_days, r.observation, r.event_key,
              r.created_by, r.created_at, r.active,
              p.last_name || ', ' || p.first_name AS person,
              t.code AS type_code, t.name AS type_name
       FROM absence_records r
       JOIN people p ON p.id = r.person_id
       JOIN absence_types t ON t.id = r.absence_type_id
       ORDER BY r.active DESC, r.date_from DESC, r.created_at DESC
       LIMIT 200`
    )
    .all() as unknown as AbsenceRow[];

  return (
    <LicenciasPanel
      nivel={nivel}
      people={people}
      types={types}
      rows={rows}
      puedeEscribir={session.user.permissions.includes("absence.write")}
    />
  );
}
