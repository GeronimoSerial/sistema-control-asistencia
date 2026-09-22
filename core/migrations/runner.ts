/**
 * Runner de migraciones versionadas.
 *
 * Reemplaza a `ensureV13Schema()`, que se ejecutaba en cada request con un flag en memoria del
 * módulo (y por lo tanto volvía a correr en cada arranque en frío de serverless). Además de
 * costar latencia, contenía escrituras de datos que pisaban la configuración del administrador:
 *
 *   UPDATE office_settings SET lateness_tolerance_minutes=15 WHERE id=1 AND lateness_tolerance_minutes<>15
 *   UPDATE office_settings SET absence_count_start_date='2026-09-12' WHERE id=1 AND ...
 *
 * Es decir: un administrador cambiaba la tolerancia desde la pantalla de configuración y la
 * siguiente instancia fría se la revertía. Con varios organismos eso es inadmisible.
 *
 * Reglas del runner:
 *  - cada migración corre **una sola vez**, registrada en `schema_migrations`;
 *  - las migraciones cambian el esquema, no la configuración de un organismo;
 *  - se invoca desde un endpoint protegido o desde un script de despliegue, nunca por request.
 */

import { sql } from "@/core/platform/db";
import type { SqlClient } from "@/core/platform/db";

export type Migration = {
  /** Identificador ordenable y estable. No se renombra nunca. */
  id: string;
  name: string;
  up: (client: SqlClient) => Promise<void>;
};

export type MigrationReport = {
  applied: string[];
  skipped: string[];
};

async function ensureMigrationsTable(client: SqlClient) {
  await client`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export async function runMigrations(migrations: Migration[]): Promise<MigrationReport> {
  const client = sql();
  await ensureMigrationsTable(client);

  const rows = (await client`SELECT id FROM schema_migrations`) as unknown as { id: string }[];
  const already = new Set(rows.map((row) => String(row.id)));

  const ordered = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  const report: MigrationReport = { applied: [], skipped: [] };

  for (const migration of ordered) {
    if (already.has(migration.id)) {
      report.skipped.push(migration.id);
      continue;
    }
    await migration.up(client);
    await client`
      INSERT INTO schema_migrations (id, name) VALUES (${migration.id}, ${migration.name})
      ON CONFLICT (id) DO NOTHING
    `;
    report.applied.push(migration.id);
  }

  return report;
}

export async function pendingMigrations(migrations: Migration[]): Promise<string[]> {
  const client = sql();
  await ensureMigrationsTable(client);
  const rows = (await client`SELECT id FROM schema_migrations`) as unknown as { id: string }[];
  const already = new Set(rows.map((row) => String(row.id)));
  return migrations.map((m) => m.id).filter((id) => !already.has(id)).sort();
}
