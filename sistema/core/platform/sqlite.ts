/**
 * Adaptador de SQLite.
 *
 * El sistema nuevo usa **una base por nivel**: `primaria.db`, `secundaria.db`. El inquilino no es
 * una columna que haya que acordarse de filtrar, es el archivo. Eso da aislamiento físico, backup
 * por nivel copiando un archivo, y esquemas planos sin `organization_id` en ninguna tabla.
 *
 * Se usa `node:sqlite`, incorporado en Node: no requiere instalar nada ni compilar binarios
 * nativos. Es estable desde Node 24; en Node 22 funciona pero emite una advertencia de función
 * experimental.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

export type OpenOptions = {
  /** Deja la base en sólo lectura salvo por las migraciones. */
  readOnly?: boolean;
  /** Omite los PRAGMA de arranque. Sólo para pruebas en memoria. */
  skipPragmas?: boolean;
};

/**
 * Abre (y crea si hace falta) un archivo de base de datos.
 *
 * Los PRAGMA importan más de lo que parece:
 * - `journal_mode = WAL` permite que haya lecturas mientras se escribe. Sin esto, cada marcación
 *   bloquea a todas las consultas del panel.
 * - `foreign_keys = ON` no viene activado por defecto en SQLite: sin él las claves foráneas se
 *   declaran pero no se verifican.
 * - `busy_timeout` evita que dos escrituras simultáneas fallen de inmediato; esperan su turno.
 */
export function openDatabase(filePath: string, options: OpenOptions = {}): Db {
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  if (!options.skipPragmas) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  return db;
}

/** Ejecuta una función dentro de una transacción. Revierte todo si algo falla. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Filas de una consulta, como objetos planos.
 *
 * `node:sqlite` devuelve las filas con **prototipo nulo**. Para leerlas da igual, pero React no
 * puede serializar un objeto así al pasarlo de un componente de servidor a uno de cliente: falla
 * en tiempo de ejecución con "Only plain objects can be passed to Client Components". Por eso se
 * normalizan acá, en el único lugar por donde pasan todas las consultas, y no en cada pantalla.
 */
export function all<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = []
): T[] {
  const rows = db.prepare(sql).all(...(params as never[])) as unknown as T[];
  return rows.map((row) => ({ ...row }));
}

export function get<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = []
): T | null {
  const row = db.prepare(sql).get(...(params as never[]));
  return row ? ({ ...(row as object) } as T) : null;
}

/** Convierte una fila de prototipo nulo en un objeto plano. `null` pasa sin cambios. */
export function plain<T>(row: T | null | undefined): T | null {
  return row ? ({ ...(row as object) } as T) : null;
}

export function run(db: Db, sql: string, params: unknown[] = []) {
  return db.prepare(sql).run(...(params as never[]));
}

/* ------------------------------------------------------------------ *
 * Conversiones
 *
 * SQLite no tiene tipos de fecha ni booleanos. La convención del proyecto:
 * - los instantes se guardan como texto ISO-8601 en UTC (`2026-09-22T14:30:00.000Z`);
 * - las fechas civiles, como `YYYY-MM-DD`;
 * - los booleanos, como 0 y 1.
 * Guardar los instantes en UTC y convertir a la zona del nivel al mostrarlos es lo que evita
 * repetir el error del sistema anterior, que concatenaba un offset fijo.
 * ------------------------------------------------------------------ */

export function nowIso(): string {
  return new Date().toISOString();
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0;
}

export function toJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function fromJson<T = unknown>(value: unknown): T | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Identificador estable para las entidades. SQLite no genera UUID por sí solo. */
export function newId(): string {
  return crypto.randomUUID();
}
