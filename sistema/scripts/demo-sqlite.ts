/**
 * Prueba de punta a punta de la arquitectura por nivel sobre SQLite.
 *
 * Crea dos niveles reales en archivos separados, les instala el paquete de reglas, carga datos y
 * comprueba que los saldos se calculan bien, que un nivel no ve nada del otro y que reinstalar
 * el paquete no pisa lo que el administrador cambió.
 *
 *   node --experimental-strip-types scripts/demo-sqlite.ts
 */

import { rmSync, existsSync, statSync } from "node:fs";
import { openDatabase } from "../core/platform/sqlite.ts";
import { initPlatform, createLevel, listLevels, findLevelBySlug } from "../core/tenancy/levels.ts";
import { initLevel } from "../core/migrations/level-schema.ts";
import { installPack } from "../packs/install.ts";
import {
  loadAbsenceTypeByCode,
  consumptionFor,
  loadEntitlementScale,
} from "../core/absence/repository.ts";
import { evaluateQuota, paidDays } from "../core/absence/quota.ts";
import { evaluateEntitlement } from "../core/absence/entitlement.ts";
import { computeLateness, type AttendancePolicy } from "../core/attendance/policy.ts";
import pack from "../packs/ar-corrientes-dge/pack.json" with { type: "json" };

const DATA_DIR = "/tmp/sis-a-demo";
let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}\n      esperado: ${b}\n      obtenido: ${a}`);
  }
}

rmSync(DATA_DIR, { recursive: true, force: true });

/* ================================================================== *
 * 1. Registro de niveles
 * ================================================================== */

console.log("\n1. Registro de niveles (platform.db)");

const platform = openDatabase(`${DATA_DIR}/platform.db`);
initPlatform(platform);

const primaria = createLevel(platform, {
  slug: "primaria", name: "Nivel Primario",
  timeZone: "America/Argentina/Buenos_Aires", locale: "es-AR",
  rulePack: "ar-corrientes-dge", dataDir: DATA_DIR,
});
const secundaria = createLevel(platform, {
  slug: "secundaria", name: "Nivel Secundario",
  timeZone: "America/Argentina/Buenos_Aires", locale: "es-AR",
  rulePack: "ar-corrientes-dge", dataDir: DATA_DIR,
});

check("se registraron dos niveles", listLevels(platform).map((l) => l.slug), ["primaria", "secundaria"]);
check("crear un nivel repetido no duplica", createLevel(platform, {
  slug: "primaria", name: "Otro nombre", timeZone: "UTC", locale: "es", dataDir: DATA_DIR,
}).id, primaria.id);
check("cada nivel apunta a su archivo", findLevelBySlug(platform, "secundaria")?.databaseFile,
  `${DATA_DIR}/secundaria.db`);

/* ================================================================== *
 * 2. Instalación del paquete de reglas en cada nivel
 * ================================================================== */

console.log("\n2. Instalación del paquete en cada nivel");

const rulePack = pack as unknown as Parameters<typeof installPack>[1];
const dbs = new Map<string, ReturnType<typeof openDatabase>>();

for (const level of [primaria, secundaria]) {
  const db = openDatabase(level.databaseFile);
  initLevel(db);
  const report = installPack(db, rulePack, "INSTALADOR");
  dbs.set(level.slug, db);
  check(`${level.slug}: tipos de ausencia instalados`, report.absenceTypes, 19);
  check(`${level.slug}: tramos de cuota instalados`, report.quotaTiers, 27);
  check(`${level.slug}: sin advertencias`, report.warnings, []);
}

const dbPrimaria = dbs.get("primaria")!;
const dbSecundaria = dbs.get("secundaria")!;

check("los archivos existen por separado",
  [existsSync(`${DATA_DIR}/primaria.db`), existsSync(`${DATA_DIR}/secundaria.db`)], [true, true]);

/* ================================================================== *
 * 3. Idempotencia: reinstalar no pisa la configuración del administrador
 * ================================================================== */

console.log("\n3. Reinstalar el paquete no revierte cambios del administrador");

dbPrimaria.prepare(
  `UPDATE settings SET value = ?, updated_by = 'ADMIN' WHERE scope_type='LEVEL' AND key = ?`
).run(JSON.stringify(120), "attendance.geofence_radius_meters");

installPack(dbPrimaria, rulePack, "INSTALADOR");

const radius = dbPrimaria.prepare(
  `SELECT value FROM settings WHERE scope_type='LEVEL' AND key = ?`
).get("attendance.geofence_radius_meters") as unknown as { value: string };
check("el radio configurado por el administrador se conserva", JSON.parse(radius.value), 120);

const typeCount = dbPrimaria.prepare(`SELECT COUNT(*) AS n FROM absence_types`).get() as unknown as { n: number };
check("reinstalar no duplica tipos de ausencia", typeCount.n, 19);

/* ================================================================== *
 * 4. Datos en cada nivel y aislamiento
 * ================================================================== */

console.log("\n4. Aislamiento entre niveles");

function addPerson(db: ReturnType<typeof openDatabase>, id: string, last: string, first: string, dni: string, seniority: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO people (id, last_name, first_name, national_id, employment, seniority_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'TITULAR', ?, ?, ?)`
  ).run(id, last, first, dni, seniority, now, now);
  return id;
}

addPerson(dbPrimaria, "p1", "Gómez", "Ana", "20111222", "2012-03-01");
addPerson(dbSecundaria, "s1", "Ruiz", "Luis", "20333444", "2021-08-15");

const enPrimaria = dbPrimaria.prepare(`SELECT COUNT(*) AS n FROM people`).get() as unknown as { n: number };
const enSecundaria = dbSecundaria.prepare(`SELECT COUNT(*) AS n FROM people`).get() as unknown as { n: number };
check("cada nivel ve sólo su padrón", [enPrimaria.n, enSecundaria.n], [1, 1]);

const buscada = dbSecundaria.prepare(`SELECT id FROM people WHERE national_id = ?`).get("20111222");
check("el agente de primaria no existe en secundaria", buscada ?? null, null);

// El mismo documento puede repetirse entre niveles sin chocar: son bases distintas.
addPerson(dbSecundaria, "s2", "Gómez", "Ana", "20111222", "2012-03-01");
check("el mismo documento puede existir en otro nivel",
  (dbSecundaria.prepare(`SELECT COUNT(*) AS n FROM people`).get() as unknown as { n: number }).n, 2);

/* ================================================================== *
 * 5. Saldos de ausencias con el motor declarativo
 * ================================================================== */

console.log("\n5. Saldos calculados desde las reglas de la base");

function addAbsence(
  db: ReturnType<typeof openDatabase>, personId: string, typeCode: string,
  from: string, to: string, days: number, eventKey?: string
) {
  const type = loadAbsenceTypeByCode(db, typeCode)!;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO absence_records
       (id, person_id, absence_type_id, event_key, date_from, date_to, computed_days, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'test', ?, ?)`
  ).run(crypto.randomUUID(), personId, type.id, eventKey ?? null, from, to, days, now, now);
  return type;
}

// Art. 8 inc. a: 30 días al 100 % por año y el excedente sin goce.
addAbsence(dbPrimaria, "p1", "ART8A", "2026-02-01", "2026-02-20", 20);
addAbsence(dbPrimaria, "p1", "ART8A", "2026-06-01", "2026-06-15", 15);

const art8a = loadAbsenceTypeByCode(dbPrimaria, "ART8A")!;
const evalArt8a = evaluateQuota(art8a, consumptionFor(dbPrimaria, "p1", art8a.id, "2026-06-15"));
check("ART8A tramo con goce", evalArt8a.tiers[0].usedDays, 30);
check("ART8A remanente con goce", evalArt8a.tiers[0].remainingDays, 0);
check("ART8A excedente sin goce", evalArt8a.tiers[1].usedDays, 5);
check("ART8A días remunerados", paidDays(evalArt8a), 30);

// Art. 8 inc. b: dos años al 100 % y el tercero al 50 %, computado por evento.
addAbsence(dbPrimaria, "p1", "ART8B", "2025-01-10", "2026-02-13", 400, "accidente-2025");
const art8b = loadAbsenceTypeByCode(dbPrimaria, "ART8B")!;
const evalArt8b = evaluateQuota(
  art8b,
  consumptionFor(dbPrimaria, "p1", art8b.id, "2026-02-13", "accidente-2025")
);
check("ART8B imputado al tramo al 100 %", evalArt8b.tiers[0].usedDays, 400);
check("ART8B remanente al 100 %", evalArt8b.tiers[0].remainingDays, 330);
check("ART8B tramo al 50 % sin usar", evalArt8b.tiers[1].usedDays, 0);

// Art. 30 inc. b: 6 al año y no más de 2 por mes. Manda la ventana más restrictiva.
addAbsence(dbPrimaria, "p1", "ART30B", "2026-01-10", "2026-01-11", 2);
addAbsence(dbPrimaria, "p1", "ART30B", "2026-03-05", "2026-03-07", 3);
const art30b = loadAbsenceTypeByCode(dbPrimaria, "ART30B")!;
const evalArt30b = evaluateQuota(art30b, consumptionFor(dbPrimaria, "p1", art30b.id, "2026-03-07"));
check("ART30B usado en el año", evalArt30b.tiers[0].usedDays, 5);
check("ART30B remanente anual", evalArt30b.tiers[0].remainingDays, 1);
check("ART30B tope mensual agotado", evalArt30b.tiers[1].remainingDays, 0);
check("ART30B bloquea por la ventana mensual", evalArt30b.blocked, true);
check("ART30B disponible real", evalArt30b.totalRemainingDays, 0);

// Las ausencias de primaria no afectan a secundaria, aunque sea la misma persona.
const art8aSec = loadAbsenceTypeByCode(dbSecundaria, "ART8A")!;
const evalSec = evaluateQuota(art8aSec, consumptionFor(dbSecundaria, "s2", art8aSec.id, "2026-06-15"));
check("el saldo no se cruza entre niveles", evalSec.tiers[0].usedDays, 0);

/* ================================================================== *
 * 6. Escala de vacaciones y política de asistencia
 * ================================================================== */

console.log("\n6. Escala de derecho y política de asistencia");

const scale = loadEntitlementScale(dbPrimaria, "VACATION")!;
check("escala con cuatro tramos", scale.tiers.length, 4);
check("12 años de antigüedad, año completo",
  evaluateEntitlement(scale, { basisValue: 12, serviceMonths: 12 }).entitlementDays, 30);
check("3 años, 4 meses y fracción mayor",
  evaluateEntitlement(scale, { basisValue: 3, serviceMonths: 4, hasExtraFraction: true }).entitlementDays,
  Math.round(((20 / 12) * 5) * 100) / 100);

type PolicyRow = {
  code: string; name: string; lateness_tolerance_minutes: number; lateness_mode: string;
  count_early_exit: number; compensation_mode: string; auto_close_mode: string;
  auto_close_grace_minutes: number; movement_sequence: string; counting_start_date: string | null;
};
const policyRow = dbPrimaria
  .prepare(`SELECT * FROM attendance_policies WHERE is_default = 1`)
  .get() as unknown as PolicyRow;

const policy: AttendancePolicy = {
  code: policyRow.code,
  name: policyRow.name,
  latenessToleranceMinutes: policyRow.lateness_tolerance_minutes,
  latenessMode: policyRow.lateness_mode as AttendancePolicy["latenessMode"],
  countEarlyExit: policyRow.count_early_exit === 1,
  compensationMode: policyRow.compensation_mode as AttendancePolicy["compensationMode"],
  autoCloseMode: policyRow.auto_close_mode as AttendancePolicy["autoCloseMode"],
  autoCloseGraceMinutes: policyRow.auto_close_grace_minutes,
  movementSequence: policyRow.movement_sequence as AttendancePolicy["movementSequence"],
  countingStartDate: policyRow.counting_start_date,
};

check("tolerancia de la política", policy.latenessToleranceMinutes, 15);
check("dentro de la tolerancia no hay atraso", computeLateness(policy, 14), 0);
check("superada la tolerancia se computa todo", computeLateness(policy, 16), 16);

/* ================================================================== *
 * 7. Integridad referencial y tamaño
 * ================================================================== */

console.log("\n7. Integridad y tamaño de los archivos");

let fkEnforced = false;
try {
  dbPrimaria.prepare(
    `INSERT INTO person_schedules (person_id, weekday, start_time, end_time) VALUES ('inexistente', 1, '08:00', '14:00')`
  ).run();
} catch {
  fkEnforced = true;
}
check("las claves foráneas se verifican", fkEnforced, true);

// En modo WAL los datos recién escritos viven en el archivo lateral hasta el checkpoint.
dbPrimaria.exec("PRAGMA wal_checkpoint(TRUNCATE)");
const sizeKb = Math.round(statSync(`${DATA_DIR}/primaria.db`).size / 1024);
console.log(`  · primaria.db ocupa ${sizeKb} KB con el catálogo completo instalado`);

for (const db of dbs.values()) db.close();
platform.close();

console.log(
  failures === 0
    ? `\n✓ ${checks} comprobaciones, todas correctas.`
    : `\n✗ ${failures} de ${checks} comprobaciones fallaron.`
);
process.exit(failures === 0 ? 0 : 1);
