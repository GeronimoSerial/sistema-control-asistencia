import { redirect } from "next/navigation";
import { sessionWith } from "@/lib/session";
import PersonalPanel, { type PersonRow } from "./PersonalPanel";

export const dynamic = "force-dynamic";

export default async function PersonalPage({
  params,
}: {
  params: Promise<{ nivel: string }>;
}) {
  const { nivel } = await params;
  const session = await sessionWith(nivel, "people.read");
  if (!session) redirect(`/${nivel}/ingresar`);

  const { db } = session.resolved.context;

  const rows = db
    .prepare(
      `SELECT p.id, p.last_name, p.first_name, p.national_id, p.active, p.seniority_date,
              (SELECT group_concat(w) FROM (
                 SELECT weekday AS w FROM person_schedules s WHERE s.person_id = p.id ORDER BY weekday
               )) AS days,
              (SELECT start_time FROM person_schedules s WHERE s.person_id = p.id ORDER BY weekday LIMIT 1) AS start_time,
              (SELECT end_time FROM person_schedules s WHERE s.person_id = p.id ORDER BY weekday LIMIT 1) AS end_time,
              (SELECT COUNT(*) FROM credentials c WHERE c.person_id = p.id AND c.pin_hash IS NOT NULL) AS has_pin,
              (SELECT c.expires_at FROM credentials c WHERE c.person_id = p.id) AS pin_expires,
              (SELECT COUNT(*) FROM devices d WHERE d.person_id = p.id AND d.active = 1) AS device_count
       FROM people p
       ORDER BY p.active DESC, p.last_name, p.first_name`
    )
    .all() as unknown as PersonRow[];

  return (
    <PersonalPanel
      nivel={nivel}
      rows={rows}
      puedeEditar={session.user.permissions.includes("people.manage")}
      puedeCredenciales={session.user.permissions.includes("people.credentials")}
    />
  );
}
