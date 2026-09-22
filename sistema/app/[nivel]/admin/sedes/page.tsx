import { redirect } from "next/navigation";
import { sessionWith } from "@/lib/session";
import { listLocations } from "@/core/attendance/locations";
import { allDefinitions } from "@/core/config/definitions";
import { getSetting } from "@/core/config/store";
import type { Definition } from "../_ui/Campo";
import SedesPanel, { type SedeRow } from "./SedesPanel";

export const dynamic = "force-dynamic";

export default async function SedesPage({
  params,
}: {
  params: Promise<{ nivel: string }>;
}) {
  const { nivel } = await params;
  const session = await sessionWith(nivel, "settings.read");
  if (!session) redirect(`/${nivel}/ingresar`);

  const { db } = session.resolved.context;

  // La pantalla no conoce ningún parámetro de sede: los toma del registro de definiciones,
  // filtrando por ámbito. Agregar uno nuevo con `defineSetting({ scope: "LOCATION" })` lo hace
  // aparecer acá sin tocar este archivo.
  const definitions: Definition[] = allDefinitions()
    .filter((definition) => definition.scope === "LOCATION")
    .map((definition) => ({
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

  const sedes: SedeRow[] = listLocations(db).map((location) => {
    const values: Record<string, unknown> = {};
    for (const definition of definitions) {
      values[definition.key] = getSetting(db, definition.key, location.id);
    }
    return {
      id: location.id,
      code: location.code,
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      active: location.active,
      values,
    };
  });

  const valoresPorDefecto: Record<string, unknown> = {};
  for (const definition of definitions) {
    valoresPorDefecto[definition.key] = getSetting(db, definition.key, null);
  }

  return (
    <SedesPanel
      nivel={nivel}
      sedes={sedes}
      definitions={definitions}
      valoresPorDefecto={valoresPorDefecto}
      puedeEditar={session.user.permissions.includes("settings.write")}
    />
  );
}
