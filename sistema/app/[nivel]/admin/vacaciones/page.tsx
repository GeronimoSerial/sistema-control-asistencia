import { redirect } from "next/navigation";
import { sessionWith } from "@/lib/session";
import { loadEntitlementScale, loadEntitlement, usedDaysInYear } from "@/core/absence/repository";
import { completedYearsBetween } from "@/core/absence/entitlement";
import { zonedParts } from "@/core/platform/time";
import VacacionesPanel, { type PersonVacation } from "./VacacionesPanel";
import { SCALE_CODE } from "./shared";

export const dynamic = "force-dynamic";

const VACATION_TYPE = "VACACIONES";

export default async function VacacionesPage({
  params,
  searchParams,
}: {
  params: Promise<{ nivel: string }>;
  searchParams: Promise<{ anio?: string }>;
}) {
  const { nivel } = await params;
  const session = await sessionWith(nivel, "absence.read");
  if (!session) redirect(`/${nivel}/ingresar`);

  const { db, timeZone } = session.resolved.context;
  const { anio } = await searchParams;
  const year = Number(anio) || zonedParts(timeZone).year;

  const scale = loadEntitlementScale(db, SCALE_CODE);

  const people = db
    .prepare(
      `SELECT id, last_name || ', ' || first_name AS label, seniority_date
       FROM people WHERE active = 1 ORDER BY last_name, first_name`
    )
    .all() as unknown as { id: string; label: string; seniority_date: string | null }[];

  const rows: PersonVacation[] = people.map((person) => {
    const entitlement = loadEntitlement(db, person.id, SCALE_CODE, year);
    return {
      id: person.id,
      label: person.label,
      seniorityDate: person.seniority_date,
      seniorityReference: person.seniority_date
        ? completedYearsBetween(person.seniority_date.slice(0, 10), `${year}-12-31`)
        : null,
      entitlementDays: entitlement?.entitlementDays ?? null,
      basisValue: entitlement?.basisValue ?? null,
      serviceMonths: entitlement?.serviceMonths ?? null,
      extraFraction: entitlement?.extraFraction ?? false,
      usedDays: usedDaysInYear(db, person.id, VACATION_TYPE, year),
    };
  });

  return (
    <VacacionesPanel
      nivel={nivel}
      anio={year}
      rows={rows}
      tiers={scale?.tiers ?? []}
      proration={scale?.proration ?? "NONE"}
      fullAfterMonths={scale?.fullAfterMonths ?? null}
      puedeEscribir={session.user.permissions.includes("absence.write")}
    />
  );
}
