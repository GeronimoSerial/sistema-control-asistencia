/**
 * Alta de un usuario del panel, en un nivel.
 *
 * Provisional, hasta que exista la pantalla de usuarios. También sirve para restablecer una
 * contraseña: si el correo ya existe, la reemplaza.
 *
 *   npm run usuario:crear -- --nivel primaria --email ana@ejemplo.gob.ar \
 *     --clave "una contraseña larga" --rol ADMIN
 */

import { openDatabase } from "@/core/platform/sqlite";
import { initPlatform, findLevelBySlug } from "@/core/tenancy/levels";
import { hashSecret } from "@/core/platform/secrets";
import { permissionsOf } from "@/core/identity/auth";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const slug = arg("nivel");
const email = arg("email")?.trim().toLowerCase();
const clave = arg("clave");
const rol = (arg("rol") ?? "ADMIN").toUpperCase();

if (!slug || !email || !clave) {
  console.error(
    "Faltan argumentos. Ejemplo:\n" +
      '  npm run usuario:crear -- --nivel primaria --email ana@ejemplo.gob.ar --clave "contraseña larga" --rol ADMIN'
  );
  process.exit(1);
}
if (clave.length < 10) {
  console.error("La contraseña debe tener al menos 10 caracteres.");
  process.exit(1);
}

const dataDir = process.env.DATA_DIR ?? "./data";
const platform = openDatabase(`${dataDir}/platform.db`);
initPlatform(platform);
const level = findLevelBySlug(platform, slug);
if (!level) {
  console.error(`No existe el nivel «${slug}».`);
  process.exit(1);
}

const db = openDatabase(level.databaseFile);
const role = db.prepare(`SELECT id, name FROM roles WHERE code = ?`).get(rol) as
  unknown as { id: string; name: string } | undefined;
if (!role) {
  const disponibles = (db.prepare(`SELECT code FROM roles ORDER BY code`).all() as
    unknown as { code: string }[]).map((r) => r.code);
  console.error(`No existe el rol «${rol}». Disponibles: ${disponibles.join(", ")}`);
  process.exit(1);
}

const now = new Date().toISOString();
const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as
  unknown as { id: string } | undefined;
const userId = existing?.id ?? crypto.randomUUID();

db.prepare(
  `INSERT INTO users (id, email, password_hash, name, created_by, created_at, updated_at)
   VALUES (?, ?, ?, ?, 'CLI', ?, ?)
   ON CONFLICT(email) DO UPDATE SET
     password_hash = excluded.password_hash, active = 1, updated_at = excluded.updated_at`
).run(userId, email, await hashSecret(clave), arg("nombre") ?? email, now, now);

db.prepare(
  `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES (?, ?, 'CLI', ?)
   ON CONFLICT DO NOTHING`
).run(userId, role.id, now);

console.log(`${existing ? "Actualizado" : "Creado"} el usuario ${email}`);
console.log(`  nivel: ${level.name}`);
console.log(`  rol: ${role.name} (${rol})`);
console.log(`  permisos: ${permissionsOf(db, userId).join(", ")}`);
console.log(`\nIngresá en http://localhost:3000/${level.slug}/ingresar`);

db.close();
platform.close();
