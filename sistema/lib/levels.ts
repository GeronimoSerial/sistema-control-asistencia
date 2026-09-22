/**
 * Resolución del nivel en tiempo de ejecución.
 *
 * Cada nivel es un archivo SQLite. Abrir una conexión por petición sería un desperdicio y además
 * perdería el modo WAL configurado al abrir, así que las conexiones se guardan en un caché que
 * vive en `globalThis`: en desarrollo Next recarga los módulos en cada cambio, y sin eso se
 * abrirían conexiones nuevas hasta agotar los descriptores de archivo.
 */

import { openDatabase, type Db } from "@/core/platform/sqlite";
import { initLevel } from "@/core/migrations/level-schema";
import {
  initPlatform,
  findLevelBySlug,
  listLevels,
  type Level,
} from "@/core/tenancy/levels";
import { getSetting } from "@/core/config/store";
import { NEUTRAL_POLICY, type AttendancePolicy } from "@/core/attendance/policy";
import type { LevelContext } from "@/core/attendance/service";

type Cache = { platform?: Db; levels: Map<string, Db> };

const cache: Cache = ((globalThis as unknown as { __sisA?: Cache }).__sisA ??= {
  levels: new Map(),
});

export function dataDir(): string {
  return process.env.DATA_DIR ?? "./data";
}

function serverSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error("AUTH_SECRET debe estar configurada y tener al menos 24 caracteres");
  }
  return secret;
}

export function platformDb(): Db {
  if (!cache.platform) {
    cache.platform = openDatabase(`${dataDir()}/platform.db`);
    initPlatform(cache.platform);
  }
  return cache.platform;
}

export function levelDb(level: Level): Db {
  const existing = cache.levels.get(level.slug);
  if (existing) return existing;
  const db = openDatabase(level.databaseFile);
  initLevel(db); // idempotente
  cache.levels.set(level.slug, db);
  return db;
}

export function findLevel(slug: string): Level | null {
  const level = findLevelBySlug(platformDb(), slug);
  return level && level.status === "ACTIVE" ? level : null;
}

export function activeLevels(): Level[] {
  return listLevels(platformDb(), true);
}

/** Política vigente del nivel; si no hay ninguna cargada, la neutra del núcleo. */
export function levelPolicy(db: Db): AttendancePolicy {
  const row = db
    .prepare(`SELECT * FROM attendance_policies WHERE is_default = 1`)
    .get() as unknown as Record<string, string | number | null> | undefined;
  if (!row) return NEUTRAL_POLICY;
  return {
    code: String(row.code),
    name: String(row.name),
    latenessToleranceMinutes: Number(row.lateness_tolerance_minutes),
    latenessMode: String(row.lateness_mode) as AttendancePolicy["latenessMode"],
    countEarlyExit: row.count_early_exit === 1,
    compensationMode: String(row.compensation_mode) as AttendancePolicy["compensationMode"],
    autoCloseMode: String(row.auto_close_mode) as AttendancePolicy["autoCloseMode"],
    autoCloseGraceMinutes: Number(row.auto_close_grace_minutes),
    movementSequence: String(row.movement_sequence) as AttendancePolicy["movementSequence"],
    countingStartDate: row.counting_start_date ? String(row.counting_start_date) : null,
  };
}

export type ResolvedLevel = {
  level: Level;
  context: LevelContext;
  branding: { name: string; kicker: string; footer: string };
};

export function resolveLevel(slug: string): ResolvedLevel | null {
  const level = findLevel(slug);
  if (!level) return null;
  const db = levelDb(level);
  return {
    level,
    context: {
      db,
      timeZone: getSetting<string>(db, "locale.time_zone") || level.timeZone,
      policy: levelPolicy(db),
      secret: serverSecret(),
    },
    branding: {
      name: getSetting<string>(db, "branding.name") || level.name,
      kicker: getSetting<string>(db, "branding.kicker") || "",
      footer: getSetting<string>(db, "branding.footer") || level.name,
    },
  };
}

/** Sede principal del nivel. Por ahora el sistema opera con una sede activa por nivel. */
export function mainLocation(db: Db) {
  return (db
    .prepare(`SELECT id, code, name, latitude, longitude FROM locations WHERE active = 1 ORDER BY code LIMIT 1`)
    .get() as unknown as
    | { id: string; code: string; name: string; latitude: number | null; longitude: number | null }
    | undefined) ?? null;
}
