/**
 * Alta de un nivel completo.
 *
 * Crear un nivel es más que insertar una fila: hay que crear el archivo, aplicarle el esquema,
 * instalarle el paquete de reglas y —si se quiere que sirva para algo desde el primer minuto—
 * cargarle una sede y un administrador. Estaba todo escrito dentro del guion de línea de
 * comandos, que es el peor lugar posible: la pantalla de administración necesita exactamente lo
 * mismo, y dos copias del procedimiento se separan a la primera corrección.
 *
 * Acá está una sola vez. El guion y la pantalla son dos formas de llamar a esto.
 *
 * Es idempotente: volver a correrlo sobre un nivel existente no duplica nada ni pisa la
 * configuración que ya se haya cambiado a mano.
 */

import { openDatabase, type Db } from "@/core/platform/sqlite";
import { initLevel } from "@/core/migrations/level-schema";
import { installPack, type InstallReport } from "@/packs/install";
import { hashSecret } from "@/core/platform/secrets";
import { createLevel, findLevelBySlug, normalizeSlug, type Level } from "@/core/tenancy/levels";
import type { RulePack } from "@/packs/types";
import { isValidTimeZone } from "@/core/platform/time";

export type ProvisionInput = {
  slug: string;
  name: string;
  timeZone?: string;
  locale?: string;
  dataDir?: string;
  /** Sede inicial. Sin coordenadas no hay geocerca, pero el nivel funciona igual. */
  location?: { name: string; code?: string; latitude?: number | null; longitude?: number | null } | null;
  /** Primer administrador del nivel. Se le asigna el rol ADMIN del paquete. */
  admin?: { email: string; password: string; name?: string | null } | null;
  actor: string;
};

export type ProvisionResult = {
  level: Level;
  /** `false` si el nivel ya existía y esto fue una reinstalación. */
  created: boolean;
  report: InstallReport;
  locationCreated: boolean;
  adminCreated: boolean;
};

/** Error de negocio con código estable, igual que `MarkError` en asistencia. */
export class ProvisionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "ProvisionError";
    this.code = code;
  }
}

export const MIN_PASSWORD_LENGTH = 10;

export async function provisionLevel(
  platform: Db,
  pack: RulePack,
  input: ProvisionInput
): Promise<ProvisionResult> {
  const name = input.name.trim();
  if (name.length < 2) throw new ProvisionError("NAME_TOO_SHORT");

  let slug: string;
  try {
    slug = normalizeSlug(input.slug || name);
  } catch {
    throw new ProvisionError("SLUG_INVALID");
  }

  const timeZone = input.timeZone?.trim() || pack.organization.timeZone;
  if (!isValidTimeZone(timeZone)) throw new ProvisionError("TIMEZONE_INVALID");

  if (input.admin) {
    if (!/^[^\s@]+@[^\s@]+$/.test(input.admin.email.trim())) throw new ProvisionError("EMAIL_INVALID");
    if (input.admin.password.length < MIN_PASSWORD_LENGTH) throw new ProvisionError("PASSWORD_TOO_SHORT");
  }
  if (input.location) {
    const { latitude, longitude } = input.location;
    const hasOne = latitude !== null && latitude !== undefined;
    const hasOther = longitude !== null && longitude !== undefined;
    if (hasOne !== hasOther) throw new ProvisionError("COORDINATES_INCOMPLETE");
    if (hasOne && (!Number.isFinite(latitude!) || latitude! < -90 || latitude! > 90)) {
      throw new ProvisionError("LATITUDE_INVALID");
    }
    if (hasOther && (!Number.isFinite(longitude!) || longitude! < -180 || longitude! > 180)) {
      throw new ProvisionError("LONGITUDE_INVALID");
    }
    if (!input.location.name.trim()) throw new ProvisionError("LOCATION_NAME_REQUIRED");
  }

  const existed = Boolean(findLevelBySlug(platform, slug));
  const level = createLevel(platform, {
    slug,
    name,
    timeZone,
    locale: input.locale?.trim() || pack.organization.locale,
    rulePack: pack.id,
    dataDir: input.dataDir,
  });

  const db = openDatabase(level.databaseFile);
  let locationCreated = false;
  let adminCreated = false;

  try {
    initLevel(db);
    const report = installPack(db, pack, input.actor);

    if (input.location) {
      const code = (input.location.code?.trim() || "CENTRAL").toUpperCase();
      const before = db.prepare(`SELECT id FROM locations WHERE code = ?`).get(code);
      db.prepare(
        `INSERT INTO locations (id, code, name, latitude, longitude, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name,
           latitude = excluded.latitude, longitude = excluded.longitude`
      ).run(
        crypto.randomUUID(), code, input.location.name.trim(),
        input.location.latitude ?? null, input.location.longitude ?? null,
        new Date().toISOString()
      );
      locationCreated = !before;
    }

    if (input.admin) {
      const email = input.admin.email.trim().toLowerCase();
      const now = new Date().toISOString();
      const before = db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(email);
      const hash = await hashSecret(input.admin.password);
      db.prepare(
        `INSERT INTO users (id, email, password_hash, name, must_change_password, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           password_hash = excluded.password_hash, must_change_password = 1, updated_at = excluded.updated_at`
      ).run(crypto.randomUUID(), email, hash, input.admin.name?.trim() || email, input.actor, now, now);

      const user = db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(email) as
        unknown as { id: string };
      const role = db.prepare(`SELECT id FROM roles WHERE code = 'ADMIN'`).get() as
        unknown as { id: string } | undefined;
      if (!role) throw new ProvisionError("ADMIN_ROLE_MISSING");
      db.prepare(
        `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING`
      ).run(user.id, role.id, input.actor, now);
      adminCreated = !before;
    }

    return { level, created: !existed, report, locationCreated, adminCreated };
  } finally {
    db.close();
  }
}
