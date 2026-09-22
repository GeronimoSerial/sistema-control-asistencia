/**
 * Alta de un nivel desde la línea de comandos.
 *
 * Crea el archivo de base, le aplica el esquema y el paquete de reglas, y opcionalmente carga la
 * sede y el primer administrador. Es idempotente: volver a correrlo sobre un nivel existente no
 * duplica nada ni pisa la configuración ya modificada.
 *
 *   npm run nivel:crear -- --slug primaria --nombre "Nivel Primario" \
 *     --sede "Sede central" --lat -27.4692 --lng -58.8306 \
 *     --admin ana@ejemplo.gob.ar --clave "una contraseña larga"
 */

import { openDatabase } from "@/core/platform/sqlite";
import { initPlatform, createLevel, findLevelBySlug } from "@/core/tenancy/levels";
import { initLevel } from "@/core/migrations/level-schema";
import { installPack } from "@/packs/install";
import { hashSecret } from "@/core/platform/secrets";
import type { RulePack } from "@/packs/types";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const slug = arg("slug");
const nombre = arg("nombre");
if (!slug || !nombre) {
  console.error("Faltan argumentos. Ejemplo:\n" +
    '  npm run nivel:crear -- --slug primaria --nombre "Nivel Primario"');
  process.exit(1);
}

const dataDir = arg("data") ?? process.env.DATA_DIR ?? "./data";
const rulePack = pack as unknown as RulePack;

const platform = openDatabase(`${dataDir}/platform.db`);
initPlatform(platform);

const existed = Boolean(findLevelBySlug(platform, slug));
const level = createLevel(platform, {
  slug,
  name: nombre,
  timeZone: arg("tz") ?? rulePack.organization.timeZone,
  locale: arg("locale") ?? rulePack.organization.locale,
  rulePack: rulePack.id,
  dataDir,
});

const db = openDatabase(level.databaseFile);
initLevel(db);
const report = installPack(db, rulePack, "CLI");

console.log(`${existed ? "Actualizado" : "Creado"} el nivel «${level.name}» (${level.slug})`);
console.log(`  archivo: ${level.databaseFile}`);
console.log(`  reglas: ${report.absenceTypes} tipos de ausencia, ${report.quotaTiers} tramos de cuota, ` +
  `${report.scales} escalas, ${report.policies} políticas, ${report.roles} roles`);
if (report.warnings.length) {
  for (const warning of report.warnings) console.warn(`  aviso: ${warning}`);
}

/* -------- Sede -------- */

const sede = arg("sede");
if (sede) {
  const lat = arg("lat") ? Number(arg("lat")) : null;
  const lng = arg("lng") ? Number(arg("lng")) : null;
  if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) {
    console.error("  Para cargar la sede hacen falta --lat y --lng con números válidos.");
  } else {
    db.prepare(
      `INSERT INTO locations (id, code, name, latitude, longitude, created_at)
       VALUES (?, 'CENTRAL', ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name,
         latitude = excluded.latitude, longitude = excluded.longitude`
    ).run(crypto.randomUUID(), sede, lat, lng, new Date().toISOString());
    console.log(`  sede: ${sede} (${lat}, ${lng})`);
  }
}

/* -------- Primer administrador -------- */

const adminEmail = arg("admin");
const adminPassword = arg("clave");
if (adminEmail && adminPassword) {
  if (adminPassword.length < 10) {
    console.error("  La contraseña del administrador debe tener al menos 10 caracteres.");
  } else {
    const now = new Date().toISOString();
    const hash = await hashSecret(adminPassword);
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'CLI', ?, ?)
       ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`
    ).run(crypto.randomUUID(), adminEmail.toLowerCase(), hash, adminEmail, now, now);

    const user = db.prepare(`SELECT id FROM users WHERE email = ?`).get(adminEmail.toLowerCase()) as
      unknown as { id: string };
    const role = db.prepare(`SELECT id FROM roles WHERE code = 'ADMIN'`).get() as
      unknown as { id: string } | undefined;
    if (role) {
      db.prepare(
        `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES (?, ?, 'CLI', ?)
         ON CONFLICT DO NOTHING`
      ).run(user.id, role.id, now);
    }
    console.log(`  administrador: ${adminEmail}`);
  }
}

db.close();
platform.close();
console.log(`\nAbrí http://localhost:3000/${level.slug} para ver la pantalla del QR.`);
