/**
 * Prueba de las operaciones de administración: marcación manual, clasificación de salidas
 * intermedias y derecho anual de vacaciones.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/demo-gestion.ts
 */

import { rmSync } from "node:fs";
import { openDatabase } from "@/core/platform/sqlite";
import { initLevel } from "@/core/migrations/level-schema";
import { installPack } from "@/packs/install";
import { levelPolicy } from "@/lib/levels";
import {
  markEntry, markExit, markReentry, dayFor, pendingIntervals, classifyInterval,
  type LevelContext,
} from "@/core/attendance/service";
import { zonedDateTimeToUtc } from "@/core/platform/time";
import { loadEntitlementScale, loadEntitlement, usedDaysInYear, loadAbsenceTypeByCode } from "@/core/absence/repository";
import { evaluateEntitlement } from "@/core/absence/entitlement";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

const DIR = "/tmp/sis-a-gestion";
const TZ = "America/Argentina/Buenos_Aires";
let failures = 0, checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) console.log(`  ✓ ${label}`);
  else { failures += 1; console.error(`  ✗ ${label}\n      esperado: ${b}\n      obtenido: ${a}`); }
}

rmSync(DIR, { recursive: true, force: true });

const db = openDatabase(`${DIR}/primaria.db`);
initLevel(db);
installPack(db, pack as unknown as Parameters<typeof installPack>[1], "TEST");

const ctx: LevelContext = { db, timeZone: TZ, policy: levelPolicy(db), secret: "secreto-largo-de-prueba-x" };
const now = new Date().toISOString();
db.prepare(`INSERT INTO people (id,last_name,first_name,national_id,seniority_date,created_at,updated_at) VALUES ('p1','Gómez','Ana','1','2012-03-01',?,?)`).run(now, now);
for (const d of [1, 2, 3, 4, 5]) {
  db.prepare(`INSERT INTO person_schedules (person_id,weekday,start_time,end_time) VALUES ('p1',?,'08:00','14:00')`).run(d);
}

console.log("\n1. Marcación manual excepcional");

// Martes 22/09/2026. El administrador carga la jornada a mano.
const entrada = zonedDateTimeToUtc(TZ, "2026-09-22", "08:05");
markEntry(ctx, { personId: "p1", at: entrada, coordinates: null, source: "ADMIN", note: "MISSED_MARK" });
const dia = dayFor(ctx, "p1", "2026-09-22")!;
check("la entrada manual queda registrada", Boolean(dia.entry_at), true);
check("aplica la misma tolerancia que una marcación normal", dia.late_minutes, 0);

const salida = zonedDateTimeToUtc(TZ, "2026-09-22", "14:00");
const cerrado = markExit(ctx, { personId: "p1", at: salida, coordinates: null, source: "ADMIN" }) as unknown as
  { exit_type: string; pending_minutes: number };
check("la salida queda asentada como administrativa", cerrado.exit_type, "ADMIN");
check("jornada completa sin minutos adeudados", cerrado.pending_minutes, 0);

const origen = db.prepare(
  `SELECT json_extract(metadata,'$.source') AS s FROM attendance_events WHERE event_type='ENTRY' LIMIT 1`
).get() as { s: string };
check("el origen manual queda en el evento", origen.s, "ADMIN");

console.log("\n2. Clasificación de salidas intermedias");

// Otro día, con salida intermedia y reingreso.
markEntry(ctx, { personId: "p1", at: zonedDateTimeToUtc(TZ, "2026-09-23", "08:00"), coordinates: null });
markExit(ctx, { personId: "p1", at: zonedDateTimeToUtc(TZ, "2026-09-23", "10:00"), coordinates: null });
markReentry(ctx, { personId: "p1", at: zonedDateTimeToUtc(TZ, "2026-09-23", "11:30"), coordinates: null });
markExit(ctx, { personId: "p1", at: zonedDateTimeToUtc(TZ, "2026-09-23", "14:00"), coordinates: null });

const pendientes = pendingIntervals(ctx, "2026-09-23");
check("queda un intervalo esperando clasificación", pendientes.length, 1);
check("la salida final no cuenta como pendiente",
  db.prepare(`SELECT COUNT(*) n FROM attendance_intervals WHERE attendance_day_id=(SELECT id FROM attendance_days WHERE work_date='2026-09-23')`).get(), { n: 2 });

classifyInterval(ctx, pendientes[0].id, {
  reasonCode: "COMMISSION", countsAsWork: true, note: "Trámite en el Ministerio", actor: "admin@nivel",
});
check("clasificado, sale de la bandeja", pendingIntervals(ctx, "2026-09-23").length, 0);
const clasificado = db.prepare(
  `SELECT reason_code, counts_as_work, classified_by FROM attendance_intervals WHERE id = ?`
).get(pendientes[0].id) as { reason_code: string; counts_as_work: number; classified_by: string };
check("con motivo, criterio y quién lo decidió",
  [clasificado.reason_code, clasificado.counts_as_work, clasificado.classified_by],
  ["COMMISSION", 1, "admin@nivel"]);

console.log("\n3. Derecho anual de vacaciones");

const scale = loadEntitlementScale(db, "VACATION")!;
check("la escala vino del paquete", scale.tiers.length, 4);

// Debe coincidir con la fórmula del sistema anterior: 20/25/30/35 y proporcional por doceavos.
function legacy(years: number, months: number, extra: boolean) {
  const base = years <= 5 ? 20 : years <= 10 ? 25 : years <= 15 ? 30 : 35;
  if (months >= 6) return base;
  return Math.round(((base / 12) * Math.min(12, Math.max(0, months) + (extra ? 1 : 0))) * 100) / 100;
}
for (const [years, months, extra] of [[3, 12, false], [8, 12, false], [14, 12, false], [22, 12, false], [3, 4, true], [0, 0, false]] as const) {
  check(`derecho con ${years} años y ${months} meses`,
    evaluateEntitlement(scale, { basisValue: years, serviceMonths: months, hasExtraFraction: extra }).entitlementDays,
    legacy(years, months, extra));
}

const derecho = evaluateEntitlement(scale, { basisValue: 14, serviceMonths: 12 });
db.prepare(
  `INSERT INTO entitlements (id,person_id,scale_code,benefit_year,basis_value,service_months,extra_fraction,entitlement_days,updated_by,updated_at)
   VALUES (?,'p1','VACATION',2026,14,12,0,?,'test',?)`
).run(crypto.randomUUID(), derecho.entitlementDays, now);
check("se guarda y se relee", loadEntitlement(db, "p1", "VACATION", 2026)?.entitlementDays, 30);

const vac = loadAbsenceTypeByCode(db, "VACACIONES")!;
db.prepare(
  `INSERT INTO absence_records (id,person_id,absence_type_id,date_from,date_to,computed_days,created_by,created_at,updated_at)
   VALUES (?,'p1',?,'2026-01-05','2026-01-24',20,'test',?,?)`
).run(crypto.randomUUID(), vac.id, now, now);
check("los días tomados se cuentan", usedDaysInYear(db, "p1", "VACACIONES", 2026), 20);
check("y el saldo sale de la resta", 30 - usedDaysInYear(db, "p1", "VACACIONES", 2026), 10);
check("un año distinto no arrastra el consumo", usedDaysInYear(db, "p1", "VACACIONES", 2025), 0);

db.close();
console.log(failures === 0 ? `\n✓ ${checks} comprobaciones, todas correctas.` : `\n✗ ${failures} de ${checks} fallaron.`);
process.exit(failures === 0 ? 0 : 1);
