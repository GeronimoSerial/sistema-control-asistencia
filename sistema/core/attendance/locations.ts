/**
 * Sedes de un nivel.
 *
 * Una sede es el lugar donde se marca: define la geocerca y es a quien se le emite el QR. Hasta
 * ahora el sistema trabajaba con una sola, creada por la línea de comandos con el código fijo
 * `CENTRAL`, y el resto del código tomaba «la primera activa». Eso alcanzaba mientras hubiera una;
 * con dos edificios deja de alcanzar, porque la geocerca del otro rechazaría a todo el mundo.
 *
 * El radio de la geocerca no está acá: es un parámetro de configuración con ámbito `LOCATION`, y
 * vive en `settings` como cualquier otro. Así una sede puede tener 75 metros y otra 200 sin que
 * esta tabla sepa nada de radios.
 */

import type { Db } from "@/core/platform/sqlite";
import { plain } from "@/core/platform/sqlite";

export type Location = {
  id: string;
  code: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  active: number;
  createdAt: string;
};

type LocationRow = {
  id: string;
  code: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  active: number;
  created_at: string;
};

function toLocation(row: LocationRow): Location {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    active: row.active,
    createdAt: row.created_at,
  };
}

export class LocationError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "LocationError";
    this.code = code;
  }
}

/** Normaliza el código de la sede: mayúsculas, sin acentos, sólo letras, dígitos y guiones. */
export function normalizeCode(value: string): string {
  const code = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  if (code.length < 2) throw new LocationError("CODE_TOO_SHORT");
  return code;
}

export function listLocations(db: Db, onlyActive = false): Location[] {
  const sql = onlyActive
    ? `SELECT * FROM locations WHERE active = 1 ORDER BY code`
    : `SELECT * FROM locations ORDER BY active DESC, code`;
  return (db.prepare(sql).all() as unknown as LocationRow[]).map(toLocation);
}

export function findLocationByCode(db: Db, code: string): Location | null {
  const row = plain(
    db.prepare(`SELECT * FROM locations WHERE code = ?`).get(code.trim().toUpperCase()) as
      unknown as LocationRow | undefined
  );
  return row ? toLocation(row) : null;
}

export function findLocation(db: Db, id: string): Location | null {
  const row = plain(
    db.prepare(`SELECT * FROM locations WHERE id = ?`).get(id) as unknown as LocationRow | undefined
  );
  return row ? toLocation(row) : null;
}

export function countActiveLocations(db: Db): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM locations WHERE active = 1`).get() as
    unknown as { n: number };
  return Number(row.n);
}

export type LocationInput = {
  code: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
};

function validate(input: LocationInput): void {
  if (!input.name.trim()) throw new LocationError("NAME_REQUIRED");
  const hasLat = input.latitude !== null;
  const hasLng = input.longitude !== null;
  // O van las dos coordenadas o no va ninguna: una sola no define un punto, y guardarla daría una
  // geocerca que parece configurada y no lo está.
  if (hasLat !== hasLng) throw new LocationError("COORDINATES_INCOMPLETE");
  if (hasLat && (!Number.isFinite(input.latitude!) || input.latitude! < -90 || input.latitude! > 90)) {
    throw new LocationError("LATITUDE_INVALID");
  }
  if (hasLng && (!Number.isFinite(input.longitude!) || input.longitude! < -180 || input.longitude! > 180)) {
    throw new LocationError("LONGITUDE_INVALID");
  }
}

export function createLocation(db: Db, input: LocationInput): Location {
  validate(input);
  const code = normalizeCode(input.code || input.name);
  if (findLocationByCode(db, code)) throw new LocationError("CODE_TAKEN");

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO locations (id, code, name, latitude, longitude, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, code, input.name.trim(), input.latitude, input.longitude, new Date().toISOString());
  return findLocationByCode(db, code)!;
}

export function updateLocation(db: Db, id: string, input: LocationInput): Location {
  validate(input);
  const current = plain(
    db.prepare(`SELECT * FROM locations WHERE id = ?`).get(id) as unknown as LocationRow | undefined
  );
  if (!current) throw new LocationError("NOT_FOUND");

  const code = normalizeCode(input.code || input.name);
  const other = findLocationByCode(db, code);
  if (other && other.id !== id) throw new LocationError("CODE_TAKEN");

  db.prepare(
    `UPDATE locations SET code = ?, name = ?, latitude = ?, longitude = ? WHERE id = ?`
  ).run(code, input.name.trim(), input.latitude, input.longitude, id);
  return findLocationByCode(db, code)!;
}

/**
 * Activa o desactiva una sede.
 *
 * Dejar el nivel sin ninguna sede activa apagaría la marcación entera —no habría a quién emitirle
 * el QR—, así que desactivar la última se rechaza. Es el mismo criterio que con el último
 * administrador: el sistema no deja que una pantalla lo deje inoperable.
 */
export function setLocationActive(db: Db, id: string, active: boolean): void {
  if (!active && countActiveLocations(db) <= 1) {
    const row = db.prepare(`SELECT active FROM locations WHERE id = ?`).get(id) as
      unknown as { active: number } | undefined;
    if (row?.active === 1) throw new LocationError("LAST_LOCATION");
  }
  db.prepare(`UPDATE locations SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
}
