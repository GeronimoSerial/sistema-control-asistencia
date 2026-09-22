import { redirect } from "next/navigation";
import { sessionWith } from "@/lib/session";
import { definitionsByGroup } from "@/core/config/definitions";
import { getSetting } from "@/core/config/store";
import { plain } from "@/core/platform/sqlite";
import ConfigPanel, { type Definition, type Policy } from "./ConfigPanel";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage({
  params,
}: {
  params: Promise<{ nivel: string }>;
}) {
  const { nivel } = await params;
  const session = await sessionWith(nivel, "settings.read");
  if (!session) redirect(`/${nivel}/ingresar`);

  const { db } = session.resolved.context;

  // La pantalla no conoce ningún parámetro: los toma del registro de definiciones. Los de ámbito
  // de sede quedan afuera: se configuran por sede, en su propia pantalla.
  const grouped = definitionsByGroup();
  const groups: Record<string, Definition[]> = {};
  const values: Record<string, unknown> = {};

  for (const [group, todas] of Object.entries(grouped)) {
    const definitions = todas.filter((definition) => definition.scope !== "LOCATION");
    if (!definitions.length) continue;
    groups[group] = definitions.map((definition) => ({
      key: definition.key,
      type: definition.type,
      scope: definition.scope,
      group: definition.group,
      label: definition.label,
      help: definition.help,
      min: definition.min,
      max: definition.max,
      maxLength: definition.maxLength,
      options: definition.options,
    }));
    for (const definition of definitions) {
      values[definition.key] = getSetting(db, definition.key, null);
    }
  }

  const policy = plain(
    db.prepare(`SELECT * FROM attendance_policies WHERE is_default = 1`).get() as unknown as
      | Policy
      | undefined
  );

  return (
    <ConfigPanel
      nivel={nivel}
      groups={groups}
      values={values}
      policy={policy}
      puedeReglas={session.user.permissions.includes("rules.manage")}
    />
  );
}
