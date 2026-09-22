/**
 * Registro de niveles.
 *
 * Una base central mínima —`platform.db`— que sólo dice qué niveles existen y en qué archivo
 * vive cada uno. Nada de datos operativos: esos están en el archivo de cada nivel.
 *
 * Esta separación es la que permite que el módulo de administración dé de alta un nivel nuevo
 * sin tocar código: crea la fila acá, crea el archivo, le aplica el esquema y el paquete de
 * reglas, y queda funcionando.
 *
 * Las funciones reciben la base como parámetro en lugar de importarla: así el módulo no arrastra
 * dependencias y se puede probar contra una base en memoria.
 */

import type { DatabaseSync } from "node:sqlite";

type Db = DatabaseSync;

export const PLATFORM_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS levels (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,      -- primaria, secundaria
  name         TEXT NOT NULL,
  database_file TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'ACTIVE'
               CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  time_zone    TEXT NOT NULL DEFAULT 'UTC',
  locale       TEXT NOT NULL DEFAULT 'es',
  rule_pack    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Operadores de plataforma: las únicas cuentas que pueden crear o archivar niveles.
-- Los administradores de cada nivel viven dentro del archivo de su nivel, no acá.
CREATE TABLE IF NOT EXISTS platform_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL
);
`;

export type LevelStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export type Level = {
  id: string;
  slug: string;
  name: string;
  databaseFile: string;
  status: LevelStatus;
  timeZone: string;
  locale: string;
  rulePack: string | null;
  createdAt: string;
};

type LevelRow = {
  id: string;
  slug: string;
  name: string;
  database_file: string;
  status: string;
  time_zone: string;
  locale: string;
  rule_pack: string | null;
  created_at: string;
};

function toLevel(row: LevelRow): Level {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    databaseFile: row.database_file,
    status: row.status as LevelStatus,
    timeZone: row.time_zone,
    locale: row.locale,
    rulePack: row.rule_pack,
    createdAt: row.created_at,
  };
}

export function initPlatform(db: Db): void {
  db.exec(PLATFORM_SCHEMA_SQL);
}

/** Normaliza el identificador del nivel: sólo minúsculas, dígitos y guiones. */
export function normalizeSlug(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (slug.length < 2) throw new Error("El identificador del nivel es demasiado corto");
  return slug;
}

export type CreateLevelInput = {
  slug: string;
  name: string;
  timeZone: string;
  locale: string;
  rulePack?: string | null;
  /** Directorio donde viven los archivos de los niveles. */
  dataDir?: string;
};

export function createLevel(db: Db, input: CreateLevelInput): Level {
  const slug = normalizeSlug(input.slug);
  const existing = findLevelBySlug(db, slug);
  if (existing) return existing;

  const now = new Date().toISOString();
  const dir = (input.dataDir ?? "data").replace(/[\\/]+$/, "");
  const row: LevelRow = {
    id: crypto.randomUUID(),
    slug,
    name: input.name.trim(),
    database_file: `${dir}/${slug}.db`,
    status: "ACTIVE",
    time_zone: input.timeZone,
    locale: input.locale,
    rule_pack: input.rulePack ?? null,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO levels (id, slug, name, database_file, status, time_zone, locale, rule_pack, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.slug, row.name, row.database_file, row.status,
    row.time_zone, row.locale, row.rule_pack, now, now
  );

  return toLevel(row);
}

export function findLevelBySlug(db: Db, slug: string): Level | null {
  const row = db
    .prepare(`SELECT * FROM levels WHERE slug = ?`)
    .get(slug.trim().toLowerCase()) as unknown as LevelRow | undefined;
  return row ? toLevel(row) : null;
}

export function listLevels(db: Db, onlyActive = false): Level[] {
  const sql = onlyActive
    ? `SELECT * FROM levels WHERE status = 'ACTIVE' ORDER BY name`
    : `SELECT * FROM levels ORDER BY name`;
  const rows = db.prepare(sql).all() as unknown as LevelRow[];
  return rows.map(toLevel);
}

export function setLevelStatus(db: Db, slug: string, status: LevelStatus): void {
  db.prepare(`UPDATE levels SET status = ?, updated_at = ? WHERE slug = ?`).run(
    status,
    new Date().toISOString(),
    slug
  );
}
