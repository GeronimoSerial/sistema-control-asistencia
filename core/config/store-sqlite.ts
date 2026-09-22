/**
 * Lectura y escritura de la configuración de un nivel.
 *
 * Los valores se guardan como JSON. Se busca primero en el ámbito más específico —una sede
 * concreta— y luego en el nivel; si no hay nada, se usa el valor por defecto de la definición.
 */

import type { DatabaseSync } from "node:sqlite";
import { getDefinition } from "@/core/config/definitions";

type Db = DatabaseSync;

export function getSetting<T = unknown>(db: Db, key: string, locationId?: string | null): T | null {
  if (locationId) {
    const scoped = db
      .prepare(`SELECT value FROM settings WHERE scope_type='LOCATION' AND scope_id=? AND key=?`)
      .get(locationId, key) as unknown as { value: string } | undefined;
    if (scoped) return JSON.parse(scoped.value) as T;
  }
  const row = db
    .prepare(`SELECT value FROM settings WHERE scope_type='LEVEL' AND scope_id='' AND key=?`)
    .get(key) as unknown as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as T;

  const definition = getDefinition(key);
  return definition ? (definition.default as T) : null;
}

export function setSetting(
  db: Db,
  key: string,
  value: unknown,
  actor: string,
  locationId?: string | null
): void {
  db.prepare(
    `INSERT INTO settings (scope_type, scope_id, key, value, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_type, scope_id, key)
     DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(
    locationId ? "LOCATION" : "LEVEL",
    locationId ?? "",
    key,
    JSON.stringify(value),
    actor,
    new Date().toISOString()
  );
}
