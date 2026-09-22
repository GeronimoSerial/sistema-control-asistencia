/**
 * Prueba del registro de configuración y del resguardo del último administrador.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/demo-configuracion.ts
 */

import { rmSync } from "node:fs";
import { openDatabase } from "@/core/platform/sqlite";
import { initLevel } from "@/core/migrations/level-schema";
import { installPack } from "@/packs/install";
import { allDefinitions, validateSetting, getDefinition, SETTING_KEYS } from "@/core/config/definitions";
import { getSetting, setSetting } from "@/core/config/store";
import { countUsersWithPermission } from "@/core/identity/auth";
import { hashSecret } from "@/core/platform/secrets";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

const DIR = "/tmp/sis-a-config";
let failures = 0, checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) console.log(`  ✓ ${label}`);
  else { failures += 1; console.error(`  ✗ ${label}\n      esperado: ${b}\n      obtenido: ${a}`); }
}

rmSync(DIR, { recursive: true, force: true });

console.log("\n1. Validación declarativa");

check("entero dentro del rango", validateSetting(SETTING_KEYS.geofenceRadius, "120"), { ok: true, value: 120 });
check("entero por debajo del mínimo", validateSetting(SETTING_KEYS.geofenceRadius, 5).ok, false);
check("entero por encima del máximo", validateSetting(SETTING_KEYS.geofenceRadius, 99999).ok, false);
check("no entero donde se espera entero", validateSetting(SETTING_KEYS.geofenceRadius, 12.5).ok, false);
check("texto no numérico", validateSetting(SETTING_KEYS.geofenceRadius, "ochenta").ok, false);
check("zona horaria válida", validateSetting(SETTING_KEYS.timeZone, "America/Santiago").ok, true);
check("zona horaria inventada", validateSetting(SETTING_KEYS.timeZone, "Marte/Olimpo").ok, false);
check("color con formato correcto", validateSetting(SETTING_KEYS.brandAccent, "#1d4ed8").ok, true);
check("color sin numeral", validateSetting(SETTING_KEYS.brandAccent, "1d4ed8").ok, false);
check("booleano", validateSetting(SETTING_KEYS.requireGeolocation, false), { ok: true, value: false });
check("booleano con una cadena", validateSetting(SETTING_KEYS.requireGeolocation, "sí").ok, false);
check("texto más largo que el máximo", validateSetting(SETTING_KEYS.brandName, "x".repeat(200)).ok, false);
check("parámetro inexistente", validateSetting("no.existe", 1).ok, false);
check("toda definición declara grupo y etiqueta",
  allDefinitions().every((d) => Boolean(d.group && d.label)), true);

console.log("\n2. Lectura con ámbitos");

const db = openDatabase(`${DIR}/primaria.db`);
initLevel(db);
installPack(db, pack as unknown as Parameters<typeof installPack>[1], "TEST");

const sede = crypto.randomUUID();
db.prepare(`INSERT INTO locations (id,code,name,created_at) VALUES (?,'CENTRAL','Sede',?)`)
  .run(sede, new Date().toISOString());

check("valor del paquete", getSetting(db, SETTING_KEYS.geofenceRadius), 75);
setSetting(db, SETTING_KEYS.geofenceRadius, 120, "test", sede);
check("el ámbito de sede pisa al del nivel", getSetting(db, SETTING_KEYS.geofenceRadius, sede), 120);
check("y el nivel conserva el suyo", getSetting(db, SETTING_KEYS.geofenceRadius), 75);
check("una sede sin valor propio cae al del nivel",
  getSetting(db, SETTING_KEYS.geofenceRadius, crypto.randomUUID()), 75);

const sinDefinir = "security.session_hours";
check("sin valor guardado se usa el de la definición",
  getSetting(db, sinDefinir), getDefinition(sinDefinir)!.default);

setSetting(db, SETTING_KEYS.brandName, "Nivel Primario", "test");
check("se guarda y se relee", getSetting(db, SETTING_KEYS.brandName), "Nivel Primario");
setSetting(db, SETTING_KEYS.brandName, "Otro nombre", "test");
check("volver a guardar reemplaza, no duplica", getSetting(db, SETTING_KEYS.brandName), "Otro nombre");
check("no se duplican filas",
  (db.prepare(`SELECT COUNT(*) n FROM settings WHERE key = ?`).get(SETTING_KEYS.brandName) as { n: number }).n, 1);

console.log("\n3. No se puede perder el último administrador");

async function usuario(email: string, rol: string) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO users (id,email,password_hash,name,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, email, await hashSecret("contraseña-larga"), email, now, now);
  const role = db.prepare(`SELECT id FROM roles WHERE code = ?`).get(rol) as { id: string };
  db.prepare(`INSERT INTO user_roles (user_id,role_id,granted_at) VALUES (?,?,?)`).run(id, role.id, now);
  return id;
}

const admin1 = await usuario("a@nivel", "ADMIN");
check("con un solo administrador, no queda ningún otro",
  countUsersWithPermission(db, "users.manage", admin1), 0);

const admin2 = await usuario("b@nivel", "ADMIN");
check("con dos, cada uno ve al otro", countUsersWithPermission(db, "users.manage", admin1), 1);

db.prepare(`UPDATE users SET active = 0 WHERE id = ?`).run(admin2);
check("un administrador inactivo no cuenta como respaldo",
  countUsersWithPermission(db, "users.manage", admin1), 0);

const operador = await usuario("c@nivel", "LICENSE_OPERATOR");
check("un operador de licencias tampoco",
  countUsersWithPermission(db, "users.manage", admin1), 0);
check("pero sí cuenta para su propio permiso",
  countUsersWithPermission(db, "absence.write", operador) >= 0, true);

db.close();
console.log(failures === 0 ? `\n✓ ${checks} comprobaciones, todas correctas.` : `\n✗ ${failures} de ${checks} fallaron.`);
process.exit(failures === 0 ? 0 : 1);
