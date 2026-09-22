/**
 * Prueba de punta a punta del registro de asistencia sobre un nivel.
 *
 * Recorre el flujo completo —QR, PIN, dispositivo, geocerca, entrada, salida, reingreso y cierre
 * automático— contra una base real, y verifica los números que produce la política.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/demo-attendance.ts
 */

import { rmSync } from "node:fs";
import { openDatabase } from "@/core/platform/sqlite";
import { initLevel } from "@/core/migrations/sqlite/level-schema";
import { installPack } from "@/packs/install-sqlite";
import { setSetting } from "@/core/config/store-sqlite";
import type { AttendancePolicy } from "@/core/attendance/policy";
import {
  issueQrToken, validateQrToken, setPin, findPersonByPin, checkDevice, validateLocation,
  markEntry, markExit, markReentry, autoCloseOpenDays, dayFor, openAbsenceFor,
  pendingIntervals, classifyInterval, MarkError, type LevelContext,
} from "@/core/attendance/service";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

const DATA_DIR = "/tmp/sis-a-asistencia";
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

function expectError(label: string, fn: () => unknown, code: string) {
  checks += 1;
  try {
    fn();
    failures += 1;
    console.error(`  ✗ ${label}\n      esperaba el error ${code}, no hubo ninguno`);
  } catch (error) {
    const actual = error instanceof MarkError ? error.code : String(error);
    if (actual === code) console.log(`  ✓ ${label}`);
    else {
      failures += 1;
      console.error(`  ✗ ${label}\n      esperado: ${code}\n      obtenido: ${actual}`);
    }
  }
}

rmSync(DATA_DIR, { recursive: true, force: true });

/* ================================================================== *
 * Preparación
 * ================================================================== */

console.log("\n1. Nivel preparado con el paquete de reglas");

const db = openDatabase(`${DATA_DIR}/primaria.db`);
initLevel(db);
installPack(db, pack as unknown as Parameters<typeof installPack>[1], "INSTALADOR");

const policyRow = db.prepare(`SELECT * FROM attendance_policies WHERE is_default = 1`).get() as
  unknown as Record<string, string | number | null>;
const policy: AttendancePolicy = {
  code: String(policyRow.code),
  name: String(policyRow.name),
  latenessToleranceMinutes: Number(policyRow.lateness_tolerance_minutes),
  latenessMode: String(policyRow.lateness_mode) as AttendancePolicy["latenessMode"],
  countEarlyExit: policyRow.count_early_exit === 1,
  compensationMode: String(policyRow.compensation_mode) as AttendancePolicy["compensationMode"],
  autoCloseMode: String(policyRow.auto_close_mode) as AttendancePolicy["autoCloseMode"],
  autoCloseGraceMinutes: Number(policyRow.auto_close_grace_minutes),
  movementSequence: String(policyRow.movement_sequence) as AttendancePolicy["movementSequence"],
  countingStartDate: policyRow.counting_start_date ? String(policyRow.counting_start_date) : null,
};

const ctx: LevelContext = {
  db,
  timeZone: "America/Argentina/Buenos_Aires",
  policy,
  secret: "un-secreto-de-servidor-suficientemente-largo",
};

check("política tomada de la base", [policy.latenessToleranceMinutes, policy.latenessMode, policy.movementSequence],
  [15, "FULL_FROM_SCHEDULED", "MULTI"]);

// Sede con geocerca.
const locationId = crypto.randomUUID();
db.prepare(
  `INSERT INTO locations (id, code, name, latitude, longitude, created_at) VALUES (?,?,?,?,?,?)`
).run(locationId, "CENTRAL", "Sede central", -27.4692, -58.8306, new Date().toISOString());
setSetting(db, "attendance.geofence_radius_meters", 75, "test", locationId);

// Personas con horario de lunes a viernes de 08:00 a 14:00.
function addPerson(id: string, last: string, first: string, dni: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO people (id, last_name, first_name, national_id, employment, created_at, updated_at)
     VALUES (?,?,?,?,'TITULAR',?,?)`
  ).run(id, last, first, dni, now, now);
  for (const weekday of [1, 2, 3, 4, 5]) {
    db.prepare(
      `INSERT INTO person_schedules (person_id, weekday, start_time, end_time) VALUES (?,?,'08:00','14:00')`
    ).run(id, weekday);
  }
}
for (const [id, last, first, dni] of [
  ["p1", "Gómez", "Ana", "20111222"],
  ["p2", "Ruiz", "Luis", "20333444"],
  ["p3", "Paz", "Sol", "20555666"],
  ["p4", "Vera", "Juan", "20777888"],
  ["p5", "Mora", "Eva", "20999000"],
] as const) addPerson(id, last, first, dni);

/* ================================================================== *
 * 2. QR rotativo
 * ================================================================== */

console.log("\n2. QR rotativo");

const emittedAt = new Date("2026-09-22T11:00:00Z");
const qr = issueQrToken(ctx, locationId, 5, emittedAt);
check("QR válido dentro de su vigencia", validateQrToken(ctx, qr.token, new Date("2026-09-22T11:04:00Z")), true);
check("QR vencido rechazado", validateQrToken(ctx, qr.token, new Date("2026-09-22T11:06:00Z")), false);
check("token inventado rechazado", validateQrToken(ctx, "token-falso", emittedAt), false);

/* ================================================================== *
 * 3. PIN
 * ================================================================== */

console.log("\n3. PIN");

await setPin(ctx, "p1", "4821");
check("PIN correcto identifica a la persona", (await findPersonByPin(ctx, "4821"))?.id, "p1");
check("PIN incorrecto no identifica a nadie", await findPersonByPin(ctx, "9999"), null);

await setPin(ctx, "p5", "1234", { expiresAt: "2026-09-20T00:00:00.000Z" });
check("PIN provisorio vencido no sirve", await findPersonByPin(ctx, "1234"), null);

/* ================================================================== *
 * 4. Dispositivo
 * ================================================================== */

console.log("\n4. Dispositivo");

check("primer dispositivo queda vinculado",
  checkDevice(ctx, "p1", "celular-de-ana", { bindIfMissing: true }), { ok: true, boundNow: true });
check("el mismo dispositivo sigue habilitado",
  checkDevice(ctx, "p1", "celular-de-ana", { bindIfMissing: true }), { ok: true, boundNow: false });
check("otro dispositivo de la misma persona se rechaza",
  checkDevice(ctx, "p1", "celular-prestado", { bindIfMissing: true }),
  { ok: false, reason: "OTHER_DEVICE_AUTHORIZED" });
check("un dispositivo ya usado por otra persona se rechaza",
  checkDevice(ctx, "p2", "celular-de-ana", { bindIfMissing: true }),
  { ok: false, reason: "DEVICE_USED_BY_OTHER" });

/* ================================================================== *
 * 5. Geocerca
 * ================================================================== */

console.log("\n5. Geocerca");

const dentro = validateLocation(ctx, locationId, { lat: -27.46925, lng: -58.83065 });
const fuera = validateLocation(ctx, locationId, { lat: -27.4750, lng: -58.8306 });
check("dentro del radio", dentro.ok, true);
check("fuera del radio", [fuera.ok, fuera.reason], [false, "OUTSIDE_RADIUS"]);
check("la distancia se informa", Math.round(fuera.distance ?? 0) > 75, true);

/* ================================================================== *
 * 6. Tardanza y compensación
 *
 * Martes 22/09/2026, horario 08:00–14:00, zona UTC-3.
 * ================================================================== */

console.log("\n6. Tardanza, compensación y salida anticipada");

// Entra 08:20 (20 minutos tarde). Con FULL_FROM_SCHEDULED y tolerancia 15, se computan los 20.
markEntry(ctx, { personId: "p1", at: new Date("2026-09-22T11:20:00Z") });
check("tardanza superada la tolerancia: se computa todo", dayFor(ctx, "p1", "2026-09-22")?.late_minutes, 20);

// Sale 14:10: permanece 10 minutos de más, que compensan parte del atraso.
const cierreP1 = markExit(ctx, { personId: "p1", at: new Date("2026-09-22T17:10:00Z") });
check("compensación por permanencia", cierreP1.late_minutes, 20);
check("minutos adeudados tras compensar", (cierreP1 as unknown as { pending_minutes: number }).pending_minutes, 10);
check("tipo de salida", (cierreP1 as unknown as { exit_type: string }).exit_type, "EMPLOYEE");

// Entra 08:12: dentro de la tolerancia, sin atraso.
markEntry(ctx, { personId: "p2", at: new Date("2026-09-22T11:12:00Z") });
check("dentro de la tolerancia no hay atraso", dayFor(ctx, "p2", "2026-09-22")?.late_minutes, 0);

// Entra en horario y se retira 30 minutos antes.
markEntry(ctx, { personId: "p3", at: new Date("2026-09-22T11:00:00Z") });
const cierreP3 = markExit(ctx, { personId: "p3", at: new Date("2026-09-22T16:30:00Z") }) as unknown as {
  early_minutes: number; pending_minutes: number;
};
check("salida anticipada computada", cierreP3.early_minutes, 30);
check("la salida anticipada queda adeudada", cierreP3.pending_minutes, 30);

/* ================================================================== *
 * 7. Secuencia de movimientos múltiples
 * ================================================================== */

console.log("\n7. Entrada, salida intermedia, reingreso y salida");

markEntry(ctx, { personId: "p4", at: new Date("2026-09-22T11:00:00Z") });
markExit(ctx, { personId: "p4", at: new Date("2026-09-22T13:00:00Z") });
check("tras la salida intermedia la jornada figura cerrada",
  Boolean(dayFor(ctx, "p4", "2026-09-22")?.exit_at), true);

markReentry(ctx, { personId: "p4", at: new Date("2026-09-22T14:00:00Z") });
check("el reingreso reabre la jornada", dayFor(ctx, "p4", "2026-09-22")?.exit_at, null);

expectError("no se puede reingresar dos veces seguidas",
  () => markReentry(ctx, { personId: "p4", at: new Date("2026-09-22T14:30:00Z") }), "REENTRY_NOT_ALLOWED");

markExit(ctx, { personId: "p4", at: new Date("2026-09-22T17:00:00Z") });
const cierreP4 = dayFor(ctx, "p4", "2026-09-22") as unknown as { pending_minutes: number };
check("jornada completa sin minutos adeudados", cierreP4.pending_minutes, 0);

const intervalo = db.prepare(
  `SELECT exited_at, reentered_at FROM attendance_intervals WHERE person_id = 'p4'`
).get() as unknown as { exited_at: string; reentered_at: string };
check("el intervalo intermedio quedó registrado",
  [intervalo.exited_at, intervalo.reentered_at],
  ["2026-09-22T13:00:00.000Z", "2026-09-22T14:00:00.000Z"]);

// Sólo los intervalos cerrados por un reingreso son ausencias intermedias reales. Un intervalo
// abierto al final del día no es un caso pendiente: es el fin de la jornada.
const pendientes = pendingIntervals(ctx, "2026-09-22");
check("queda un intervalo pendiente de clasificación", pendientes.length, 1);
check("el pendiente es el de la salida intermedia", pendientes[0].person_id, "p4");

classifyInterval(ctx, pendientes[0].id, {
  reasonCode: "AUTHORIZED_PERMISSION", countsAsWork: false, actor: "admin@nivel",
});
check("clasificado, deja de estar pendiente", pendingIntervals(ctx, "2026-09-22").length, 0);

/* ================================================================== *
 * 8. Validaciones de secuencia y estado
 * ================================================================== */

console.log("\n8. Validaciones");

expectError("no se puede entrar dos veces el mismo día",
  () => markEntry(ctx, { personId: "p1", at: new Date("2026-09-22T12:00:00Z") }), "ENTRY_EXISTS");

expectError("no se puede salir sin haber entrado",
  () => markExit(ctx, { personId: "p5", at: new Date("2026-09-22T17:00:00Z") }), "NO_ENTRY");

// Domingo 20/09/2026: sin horario asignado.
expectError("no se puede marcar un día sin horario",
  () => markEntry(ctx, { personId: "p5", at: new Date("2026-09-20T11:00:00Z") }), "NO_SCHEDULE");

// Con una licencia vigente no corresponde marcar.
const tipoLicencia = db.prepare(`SELECT id FROM absence_types WHERE code = 'ART8A'`).get() as
  unknown as { id: string };
const ahora = new Date().toISOString();
db.prepare(
  `INSERT INTO absence_records (id, person_id, absence_type_id, date_from, date_to, computed_days, created_by, created_at, updated_at)
   VALUES (?,?,?,?,?,?,'test',?,?)`
).run(crypto.randomUUID(), "p5", tipoLicencia.id, "2026-09-21", "2026-09-25", 5, ahora, ahora);

check("la licencia se detecta para esa fecha", openAbsenceFor(ctx, "p5", "2026-09-22")?.code, "ART8A");
expectError("con licencia vigente no se marca",
  () => markEntry(ctx, { personId: "p5", at: new Date("2026-09-22T11:00:00Z") }), "ON_ABSENCE");

/* ================================================================== *
 * 9. Cierre automático
 * ================================================================== */

console.log("\n9. Cierre automático");

// Lunes 21/09: entra 08:00 y nunca marca salida.
markEntry(ctx, { personId: "p2", at: new Date("2026-09-21T11:00:00Z") });
// Quedan dos jornadas abiertas de p2: la del lunes y la del martes, que entró 08:12 y no salió.
const cerradas = autoCloseOpenDays(ctx, new Date("2026-09-22T20:00:00Z"));
check("se cerraron las dos jornadas abiertas", cerradas, 2);

const diaCerrado = db.prepare(
  `SELECT exit_at, exit_type FROM attendance_days WHERE person_id='p2' AND work_date='2026-09-21'`
).get() as unknown as { exit_at: string; exit_type: string };
// 14:00 local en UTC-3 son las 17:00Z. El sistema anterior concatenaba el offset; acá se calcula.
check("la salida se imputa al horario previsto", diaCerrado.exit_at, "2026-09-21T17:00:00.000Z");
check("queda marcada como automática", diaCerrado.exit_type, "AUTO");
check("volver a correrlo no cierra nada más",
  autoCloseOpenDays(ctx, new Date("2026-09-22T20:00:00Z")), 0);

/* ================================================================== *
 * 10. La zona horaria del nivel manda
 * ================================================================== */

console.log("\n10. Zona horaria por nivel");

const ctxChile: LevelContext = { ...ctx, timeZone: "America/Santiago" };
markEntry(ctx, { personId: "p5", at: new Date("2026-07-14T12:00:00Z") });  // martes, 09:00 en AR
const cerradasChile = autoCloseOpenDays(ctxChile, new Date("2026-07-15T23:00:00Z"));
check("cierra la jornada con la zona del contexto", cerradasChile, 1);

const diaChile = db.prepare(
  `SELECT work_date, exit_at FROM attendance_days WHERE person_id='p5' AND work_date LIKE '2026-07%'`
).get() as unknown as { work_date: string; exit_at: string };
// En julio Santiago está en UTC-4, así que las 14:00 locales son las 18:00Z.
// Con el offset fijo de -03:00 del sistema anterior habrían quedado las 17:00Z.
check("el offset se calcula para esa fecha y zona", diaChile.exit_at, "2026-07-14T18:00:00.000Z");

db.close();

console.log(
  failures === 0
    ? `\n✓ ${checks} comprobaciones, todas correctas.`
    : `\n✗ ${failures} de ${checks} comprobaciones fallaron.`
);
process.exit(failures === 0 ? 0 : 1);
