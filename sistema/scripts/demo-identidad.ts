/**
 * Prueba de autenticación y permisos por nivel.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/demo-identidad.ts
 */

import { rmSync } from "node:fs";
import { openDatabase } from "@/core/platform/sqlite";
import { initLevel } from "@/core/migrations/level-schema";
import { installPack } from "@/packs/install";
import { authenticate, loadUser, permissionsOf, can, setPassword } from "@/core/identity/auth";
import { hashSecret } from "@/core/platform/secrets";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

const DIR = "/tmp/sis-a-identidad";
let failures = 0, checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) console.log(`  ✓ ${label}`);
  else { failures += 1; console.error(`  ✗ ${label}\n      esperado: ${b}\n      obtenido: ${a}`); }
}

rmSync(DIR, { recursive: true, force: true });

async function nivel(nombre: string) {
  const db = openDatabase(`${DIR}/${nombre}.db`);
  initLevel(db);
  installPack(db, pack as unknown as Parameters<typeof installPack>[1], "TEST");
  return db;
}

async function usuario(db: ReturnType<typeof openDatabase>, email: string, clave: string, rol: string) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO users (id,email,password_hash,name,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, email, await hashSecret(clave), email, now, now);
  const role = db.prepare(`SELECT id FROM roles WHERE code = ?`).get(rol) as unknown as { id: string };
  db.prepare(`INSERT INTO user_roles (user_id,role_id,granted_at) VALUES (?,?,?)`).run(id, role.id, now);
  return id;
}

console.log("\n1. Autenticación");
const primaria = await nivel("primaria");
const adminId = await usuario(primaria, "admin@primaria", "contraseña-larga", "ADMIN");
await usuario(primaria, "licencias@primaria", "contraseña-larga", "LICENSE_OPERATOR");

check("credenciales correctas", (await authenticate(primaria, "admin@primaria", "contraseña-larga"))?.id, adminId);
check("contraseña incorrecta", await authenticate(primaria, "admin@primaria", "otra-cosa"), null);
check("correo inexistente", await authenticate(primaria, "nadie@primaria", "contraseña-larga"), null);
check("el correo no distingue mayúsculas", Boolean(await authenticate(primaria, "ADMIN@PRIMARIA", "contraseña-larga")), true);

console.log("\n2. Permisos por rol");
const admin = loadUser(primaria, adminId)!;
check("el administrador tiene todos los permisos del pack", admin.permissions.length, 13);
check("puede administrar el padrón", can(admin, "people.manage"), true);

const operador = (await authenticate(primaria, "licencias@primaria", "contraseña-larga"))!;
check("el operador de licencias tiene tres permisos", operador.permissions.sort(), ["absence.read", "absence.write", "people.read"]);
check("no puede administrar usuarios", can(operador, "users.manage"), false);
check("no puede marcar manualmente", can(operador, "attendance.mark_manual"), false);

console.log("\n3. Aislamiento entre niveles");
const secundaria = await nivel("secundaria");
check("el administrador de primaria no existe en secundaria",
  await authenticate(secundaria, "admin@primaria", "contraseña-larga"), null);
check("tampoco se lo puede cargar por id", loadUser(secundaria, adminId), null);

console.log("\n4. Cambios con efecto inmediato");
const role = secundaria.prepare(`SELECT id FROM roles WHERE code='ADMIN'`).get() as unknown as { id: string };
secundaria.prepare(`DELETE FROM role_permissions WHERE role_id = ? AND permission_code = 'users.manage'`).run(role.id);
const otroId = await usuario(secundaria, "admin@secundaria", "contraseña-larga", "ADMIN");
check("quitar un permiso del rol se refleja al instante",
  permissionsOf(secundaria, otroId).includes("users.manage"), false);

await setPassword(primaria, adminId, "nueva-contraseña-larga", { mustChange: true });
check("la contraseña vieja deja de servir", await authenticate(primaria, "admin@primaria", "contraseña-larga"), null);
check("la nueva funciona y exige cambio",
  (await authenticate(primaria, "admin@primaria", "nueva-contraseña-larga"))?.mustChangePassword, true);

primaria.close(); secundaria.close();
console.log(failures === 0 ? `\n✓ ${checks} comprobaciones, todas correctas.` : `\n✗ ${failures} de ${checks} fallaron.`);
process.exit(failures === 0 ? 0 : 1);
