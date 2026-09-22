/**
 * Alta de niveles, operadores de plataforma y sedes.
 *
 * Esto es lo que antes sólo se podía hacer por línea de comandos. Las tres cosas que importan y
 * que se prueban acá:
 *
 * 1. Que crear un nivel deje un nivel **usable**: con reglas, con sede y con alguien que pueda
 *    entrar. Un nivel a medio crear se descubre recién cuando alguien intenta usarlo.
 * 2. Que los niveles sigan aislados. Son archivos distintos, así que el aislamiento es una
 *    propiedad del diseño y no de una cláusula `WHERE`, pero conviene verificarlo de todos modos.
 * 3. Que ninguna operación pueda dejar el sistema sin administración: ni sin operadores de
 *    plataforma, ni un nivel sin sede activa.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/demo-plataforma.ts
 */

import { rmSync, existsSync } from "node:fs";
import { openDatabase } from "@/core/platform/sqlite";
import { initPlatform, listLevels, setLevelStatus, findLevelBySlug } from "@/core/tenancy/levels";
import { provisionLevel } from "@/core/tenancy/provision";
import {
  createOperator, authenticateOperator, listOperators, setOperatorActive,
  countActiveOperators, setOperatorPassword,
} from "@/core/tenancy/operators";
import {
  listLocations, createLocation, updateLocation, setLocationActive,
  findLocationByCode, normalizeCode, LocationError,
} from "@/core/attendance/locations";
import { authenticate } from "@/core/identity/auth";
import {
  issueQrToken, resolveQrToken, validateLocation, type LevelContext,
} from "@/core/attendance/service";
import { NEUTRAL_POLICY } from "@/core/attendance/policy";
import { getSetting, setSetting } from "@/core/config/store";
import type { RulePack } from "@/packs/types";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

const DATA_DIR = "/tmp/sis-a-plataforma";
let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}\n      esperado: ${b}\n      obtenido: ${a}`);
  }
}

async function expectError(label: string, fn: () => unknown, code: string) {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.error(`  ✗ ${label}\n      esperaba el error ${code}, no hubo ninguno`);
  } catch (error) {
    const actual = error instanceof Error ? (error as { code?: string }).code ?? error.message : String(error);
    if (actual === code) console.log(`  ✓ ${label}`);
    else {
      failures += 1;
      console.error(`  ✗ ${label}\n      esperado: ${code}\n      obtenido: ${actual}`);
    }
  }
}

rmSync(DATA_DIR, { recursive: true, force: true });
const rulePack = pack as unknown as RulePack;

/* ================================================================== *
 * 1. Operadores de plataforma
 * ================================================================== */

console.log("\n1. Operadores de plataforma");

const platform = openDatabase(`${DATA_DIR}/platform.db`);
initPlatform(platform);

check("una plataforma nueva no tiene operadores", countActiveOperators(platform), 0);

const ana = await createOperator(platform, { email: "Ana@Ejemplo.gob.ar", password: "clave-larga-1" });
check("el correo se guarda normalizado", ana.email, "ana@ejemplo.gob.ar");

await expectError("la contraseña corta se rechaza",
  () => createOperator(platform, { email: "x@y.z", password: "corta" }), "PASSWORD_TOO_SHORT");
await expectError("y el correo inválido también",
  () => createOperator(platform, { email: "no-es-correo", password: "clave-larga-1" }), "EMAIL_INVALID");

check("entra con su clave",
  (await authenticateOperator(platform, "ana@ejemplo.gob.ar", "clave-larga-1"))?.email,
  "ana@ejemplo.gob.ar");
check("no entra con otra", await authenticateOperator(platform, "ana@ejemplo.gob.ar", "otra-clave-1"), null);
check("ni una cuenta inexistente", await authenticateOperator(platform, "nadie@ejemplo", "clave-larga-1"), null);

await expectError("no se puede desactivar al último operador",
  () => setOperatorActive(platform, ana.id, false), "LAST_OPERATOR");

const beto = await createOperator(platform, { email: "beto@ejemplo.gob.ar", password: "clave-larga-2" });
setOperatorActive(platform, ana.id, false);
check("con dos, sí se puede desactivar a uno", countActiveOperators(platform), 1);
check("y el desactivado no puede entrar",
  await authenticateOperator(platform, "ana@ejemplo.gob.ar", "clave-larga-1"), null);
setOperatorActive(platform, ana.id, true);

await setOperatorPassword(platform, beto.id, "clave-nueva-larga");
check("el cambio de clave surte efecto",
  (await authenticateOperator(platform, "beto@ejemplo.gob.ar", "clave-nueva-larga"))?.email,
  "beto@ejemplo.gob.ar");
check("y la anterior deja de servir",
  await authenticateOperator(platform, "beto@ejemplo.gob.ar", "clave-larga-2"), null);
check("hay dos operadores listados", listOperators(platform).length, 2);

/* ================================================================== *
 * 2. Alta de un nivel completo
 * ================================================================== */

console.log("\n2. Un nivel creado desde la pantalla queda usable");

const primaria = await provisionLevel(platform, rulePack, {
  slug: "primaria",
  name: "Nivel Primario",
  dataDir: DATA_DIR,
  location: { name: "Sede central", latitude: -27.4692, longitude: -58.8306 },
  admin: { email: "directora@primaria.gob.ar", password: "clave-directora" },
  actor: "ana@ejemplo.gob.ar",
});

check("se creó", [primaria.created, primaria.level.slug], [true, "primaria"]);
check("con su archivo propio", existsSync(primaria.level.databaseFile), true);
check("con el catálogo de licencias instalado", primaria.report.absenceTypes > 0, true);
check("con la sede cargada", primaria.locationCreated, true);
check("y con su administrador", primaria.adminCreated, true);

const dbPrimaria = openDatabase(primaria.level.databaseFile);

const directora = await authenticate(dbPrimaria, "directora@primaria.gob.ar", "clave-directora");
check("el administrador puede entrar", directora?.email, "directora@primaria.gob.ar");
check("con los permisos del rol ADMIN",
  [directora?.permissions.includes("people.manage"), directora?.permissions.includes("settings.write")],
  [true, true]);
check("y con la clave marcada para cambiar", directora?.mustChangePassword, true);

check("la sede quedó activa y con coordenadas",
  listLocations(dbPrimaria, true).map((l) => [l.code, l.active, l.latitude]),
  [["CENTRAL", 1, -27.4692]]);

/* -------- Idempotencia -------- */

const otraVez = await provisionLevel(platform, rulePack, {
  slug: "primaria",
  name: "Nivel Primario",
  dataDir: DATA_DIR,
  actor: "ana@ejemplo.gob.ar",
});
check("volver a crearlo no lo duplica", [otraVez.created, listLevels(platform).length], [false, 1]);

// Una reinstalación del paquete no debe pisar lo que alguien ya cambió a mano.
setSetting(dbPrimaria, "branding.name", "Escuela N° 1", "test");
await provisionLevel(platform, rulePack, {
  slug: "primaria", name: "Nivel Primario", dataDir: DATA_DIR, actor: "ana@ejemplo.gob.ar",
});
check("ni pisa la configuración ya modificada",
  getSetting<string>(dbPrimaria, "branding.name"), "Escuela N° 1");

/* ================================================================== *
 * 3. Lo que el alta rechaza
 * ================================================================== */

console.log("\n3. Altas rechazadas");

const malas: [string, Parameters<typeof provisionLevel>[2], string][] = [
  ["un nombre de una letra", { slug: "x", name: "x", actor: "t" }, "NAME_TOO_SHORT"],
  ["una zona horaria inventada",
    { slug: "sec", name: "Secundaria", timeZone: "America/Nunca_Jamas", actor: "t" }, "TIMEZONE_INVALID"],
  ["un correo de administrador inválido",
    { slug: "sec", name: "Secundaria", admin: { email: "arroba-no", password: "clave-larga-3" }, actor: "t" },
    "EMAIL_INVALID"],
  ["una clave de administrador corta",
    { slug: "sec", name: "Secundaria", admin: { email: "a@b.c", password: "corta" }, actor: "t" },
    "PASSWORD_TOO_SHORT"],
  ["media coordenada",
    { slug: "sec", name: "Secundaria", location: { name: "Anexo", latitude: -27.4 }, actor: "t" },
    "COORDINATES_INCOMPLETE"],
  ["una latitud imposible",
    { slug: "sec", name: "Secundaria", location: { name: "Anexo", latitude: 120, longitude: -58 }, actor: "t" },
    "LATITUDE_INVALID"],
];

for (const [label, input, code] of malas) {
  await expectError(label, () => provisionLevel(platform, rulePack, { ...input, dataDir: DATA_DIR }), code);
}
check("ninguna de esas creó un nivel", listLevels(platform).length, 1);

/* ================================================================== *
 * 4. Dos niveles, dos archivos
 * ================================================================== */

console.log("\n4. Aislamiento entre niveles");

const secundaria = await provisionLevel(platform, rulePack, {
  slug: "secundaria",
  name: "Nivel Secundario",
  dataDir: DATA_DIR,
  location: { name: "Sede secundaria", latitude: -27.47, longitude: -58.83 },
  admin: { email: "rector@secundaria.gob.ar", password: "clave-rector-1" },
  actor: "ana@ejemplo.gob.ar",
});

check("son archivos distintos",
  primaria.level.databaseFile !== secundaria.level.databaseFile, true);

const dbSecundaria = openDatabase(secundaria.level.databaseFile);
check("el administrador de uno no existe en el otro",
  await authenticate(dbSecundaria, "directora@primaria.gob.ar", "clave-directora"), null);
check("y el del otro tampoco en el primero",
  await authenticate(dbPrimaria, "rector@secundaria.gob.ar", "clave-rector-1"), null);
check("la marca cambiada en uno no afecta al otro",
  getSetting<string>(dbSecundaria, "branding.name") === "Escuela N° 1", false);

/* -------- Estados -------- */

setLevelStatus(platform, "secundaria", "SUSPENDED");
check("un nivel suspendido deja de estar entre los activos",
  listLevels(platform, true).map((level) => level.slug), ["primaria"]);
check("pero sigue existiendo", findLevelBySlug(platform, "secundaria")?.status, "SUSPENDED");
check("y su archivo sigue ahí", existsSync(secundaria.level.databaseFile), true);
setLevelStatus(platform, "secundaria", "ACTIVE");
check("volver a activarlo lo restituye", listLevels(platform, true).length, 2);

/* ================================================================== *
 * 5. Sedes
 * ================================================================== */

console.log("\n5. Varias sedes en un nivel");

check("el código se normaliza", normalizeCode("Anexo Güemes"), "ANEXO-GUEMES");

const anexo = createLocation(dbPrimaria, {
  code: "anexo norte", name: "Anexo Norte", latitude: -27.44, longitude: -58.81,
});
check("la sede nueva queda activa", [anexo.code, anexo.active], ["ANEXO-NORTE", 1]);
check("y el nivel tiene dos", listLocations(dbPrimaria, true).length, 2);

check("se puede buscar por código", findLocationByCode(dbPrimaria, "anexo-norte")?.name, "Anexo Norte");

// Cada sede lleva su propio radio: es lo que el ámbito LOCATION del parámetro significaba.
setSetting(dbPrimaria, "attendance.geofence_radius_meters", 75, "test",
  findLocationByCode(dbPrimaria, "CENTRAL")!.id);
setSetting(dbPrimaria, "attendance.geofence_radius_meters", 250, "test", anexo.id);
check("cada sede guarda su propio radio",
  [
    getSetting<number>(dbPrimaria, "attendance.geofence_radius_meters",
      findLocationByCode(dbPrimaria, "CENTRAL")!.id),
    getSetting<number>(dbPrimaria, "attendance.geofence_radius_meters", anexo.id),
  ],
  [75, 250]);

const conNombreNuevo = updateLocation(dbPrimaria, anexo.id, {
  code: "ANEXO-NORTE", name: "Anexo Norte (planta alta)", latitude: -27.44, longitude: -58.81,
});
check("se puede renombrar", conNombreNuevo.name, "Anexo Norte (planta alta)");

let choque = "";
try {
  createLocation(dbPrimaria, { code: "CENTRAL", name: "Otra", latitude: null, longitude: null });
} catch (error) {
  choque = error instanceof LocationError ? error.code : String(error);
}
check("dos sedes no pueden compartir el código", choque, "CODE_TAKEN");

let media = "";
try {
  createLocation(dbPrimaria, { code: "MEDIA", name: "Media", latitude: -27.4, longitude: null });
} catch (error) {
  media = error instanceof LocationError ? error.code : String(error);
}
check("ni cargarse con media coordenada", media, "COORDINATES_INCOMPLETE");

const sinGeocerca = createLocation(dbPrimaria, {
  code: "MOVIL", name: "Equipo móvil", latitude: null, longitude: null,
});
check("una sede sin coordenadas es válida", [sinGeocerca.code, sinGeocerca.latitude], ["MOVIL", null]);

setLocationActive(dbPrimaria, sinGeocerca.id, false);
check("desactivarla la saca de las activas",
  listLocations(dbPrimaria, true).map((l) => l.code), ["ANEXO-NORTE", "CENTRAL"]);

setLocationActive(dbPrimaria, anexo.id, false);
let ultima = "";
try {
  setLocationActive(dbPrimaria, findLocationByCode(dbPrimaria, "CENTRAL")!.id, false);
} catch (error) {
  ultima = error instanceof LocationError ? error.code : String(error);
}
check("no se puede desactivar la última sede activa", ultima, "LAST_LOCATION");
check("así que siempre queda una", listLocations(dbPrimaria, true).length, 1);

/* ================================================================== *
 * 6. El QR sabe de qué sede salió
 * ================================================================== */

console.log("\n6. Cada sede valida contra su propia geocerca");

setLocationActive(dbPrimaria, anexo.id, true);
const central = findLocationByCode(dbPrimaria, "CENTRAL")!;
const norte = findLocationByCode(dbPrimaria, "ANEXO-NORTE")!;

const ctx: LevelContext = {
  db: dbPrimaria,
  timeZone: "America/Argentina/Buenos_Aires",
  policy: NEUTRAL_POLICY,
  secret: "x".repeat(32),
};

const qrCentral = issueQrToken(ctx, central.id, 5);
const qrNorte = issueQrToken(ctx, norte.id, 5);

check("el código de la central se resuelve a la central",
  resolveQrToken(ctx, qrCentral.token)?.locationId, central.id);
check("y el del anexo, al anexo",
  resolveQrToken(ctx, qrNorte.token)?.locationId, norte.id);
check("un código inventado no resuelve a nada", resolveQrToken(ctx, "no-existe"), null);

// Éste es el punto: parado en la central, el código de la central deja marcar y el del anexo no.
// Antes del cambio, ambos validaban contra «la primera sede activa» y uno de los dos edificios
// quedaba sin poder marcar nunca.
const enLaCentral = { lat: central.latitude!, lng: central.longitude!, accuracy: 10 };
check("estando en la central, la central acepta",
  validateLocation(ctx, central.id, enLaCentral).ok, true);
check("y el anexo rechaza",
  validateLocation(ctx, norte.id, enLaCentral).ok, false);

dbPrimaria.close();
dbSecundaria.close();
platform.close();

console.log(
  failures === 0
    ? `\n✓ ${checks} comprobaciones, todas correctas.\n`
    : `\n✗ ${failures} de ${checks} comprobaciones fallaron.\n`
);
process.exit(failures === 0 ? 0 : 1);
