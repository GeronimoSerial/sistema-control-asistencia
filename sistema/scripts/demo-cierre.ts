/**
 * Cierre automático: lo que cierra, lo que no, y la reparación de lo que quedó roto.
 *
 * El cierre imputaba la salida al horario previsto sin mirar el último movimiento. Eso producía
 * jornadas que no cerraban nunca y que además se ensuciaban un poco más en cada corrida, y —en el
 * caso de una entrada posterior al horario— jornadas que quedaban incorregibles para siempre.
 *
 * Las comprobaciones de abajo son, en orden: que lo normal siga funcionando igual, que los dos
 * casos rotos ahora se detengan en vez de romper, que detenerse sea visible, y que las jornadas ya
 * dañadas se puedan reparar sin inventar datos.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/demo-cierre.ts
 */

import { rmSync } from "node:fs";
import { openDatabase } from "@/core/platform/sqlite";
import { initLevel } from "@/core/migrations/level-schema";
import { installPack } from "@/packs/install";
import type { AttendancePolicy } from "@/core/attendance/policy";
import {
  markEntry, markExit, markReentry, autoCloseOpenDays, blockedAutoCloses,
  dayFor, correctMovement, MarkError, type LevelContext,
} from "@/core/attendance/service";
import { repairAutoCloses } from "@/core/attendance/repair";
import { zonedDateTimeToUtc } from "@/core/platform/time";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

const DATA_DIR = "/tmp/sis-a-cierre";
const ZONE = "America/Argentina/Buenos_Aires";
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

rmSync(DATA_DIR, { recursive: true, force: true });

const db = openDatabase(`${DATA_DIR}/n.db`);
initLevel(db);
installPack(db, pack as unknown as Parameters<typeof installPack>[1], "T");

const row = db.prepare(`SELECT * FROM attendance_policies WHERE is_default = 1`).get() as
  unknown as Record<string, string | number | null>;
const policy: AttendancePolicy = {
  code: String(row.code), name: String(row.name),
  latenessToleranceMinutes: Number(row.lateness_tolerance_minutes),
  latenessMode: String(row.lateness_mode) as AttendancePolicy["latenessMode"],
  countEarlyExit: row.count_early_exit === 1,
  compensationMode: String(row.compensation_mode) as AttendancePolicy["compensationMode"],
  autoCloseMode: String(row.auto_close_mode) as AttendancePolicy["autoCloseMode"],
  autoCloseGraceMinutes: Number(row.auto_close_grace_minutes),
  movementSequence: String(row.movement_sequence) as AttendancePolicy["movementSequence"],
  countingStartDate: null,
};
const ctx: LevelContext = { db, timeZone: ZONE, policy, secret: "x".repeat(32) };

const now = new Date().toISOString();
for (const [id, apellido] of [["p1","Normal"],["p2","Reingreso"],["p3","Tardia"],["p4","Danada"],["p5","Invertida"]] as const) {
  db.prepare(
    `INSERT INTO people (id,last_name,first_name,national_id,employment,created_at,updated_at)
     VALUES (?,?,'X',?,'TITULAR',?,?)`
  ).run(id, apellido, `DNI-${id}`, now, now);
  for (const weekday of [1, 2, 3, 4, 5]) {
    db.prepare(
      `INSERT INTO person_schedules (person_id,weekday,start_time,end_time) VALUES (?,?,'08:00','12:00')`
    ).run(id, weekday);
  }
}

const D = "2026-09-14"; // lunes
const at = (hhmm: string) => zonedDateTimeToUtc(ZONE, D, hhmm);
const DESPUES = new Date("2026-09-20T18:00:00Z");
const vigentes = (p: string) =>
  (db
    .prepare(
      `SELECT event_type FROM attendance_events WHERE person_id = ? AND voided_at IS NULL
       ORDER BY occurred_at, id`
    )
    .all(p) as unknown as { event_type: string }[]).map((e) => e.event_type);

/* ================================================================== *
 * 1. El caso normal no cambia
 * ================================================================== */

console.log("\n1. La jornada que sólo se olvidó de salir");

markEntry(ctx, { personId: "p1", at: at("08:00"), source: "ADMIN" });
check("se cierra", autoCloseOpenDays(ctx, DESPUES).closed >= 1, true);
check("la salida se imputa al horario previsto",
  dayFor(ctx, "p1", D)!.exit_at, at("12:00").toISOString());
check("y queda marcada como automática", dayFor(ctx, "p1", D)!.exit_type, "AUTO");
check("volver a correrlo no la toca",
  autoCloseOpenDays(ctx, DESPUES), { closed: 0, blocked: 0 });

/* ================================================================== *
 * 2. Reingreso posterior al horario: se detiene
 * ================================================================== */

console.log("\n2. Reingresó después de su horario y no salió");

markEntry(ctx, { personId: "p2", at: at("09:00"), source: "ADMIN" });
markExit(ctx, { personId: "p2", at: at("10:00"), source: "ADMIN" });
markReentry(ctx, { personId: "p2", at: at("15:00"), source: "ADMIN" });

check("el cierre no la cierra, la traba", autoCloseOpenDays(ctx, DESPUES), { closed: 0, blocked: 1 });
check("no se insertó ninguna salida automática",
  vigentes("p2"), ["ENTRY", "EXIT", "REENTRY"]);
check("la jornada sigue abierta", dayFor(ctx, "p2", D)!.exit_at, null);

// Lo que antes pasaba: tres corridas, tres salidas automáticas apiladas.
autoCloseOpenDays(ctx, DESPUES);
autoCloseOpenDays(ctx, DESPUES);
check("y no se ensucia por más veces que corra",
  vigentes("p2"), ["ENTRY", "EXIT", "REENTRY"]);

check("queda anotada con su motivo",
  blockedAutoCloses(ctx).map((b) => [b.person_id, b.reason]),
  [["p2", "LAST_MOVEMENT_AFTER_SCHEDULED_END"]]);

// Y sigue siendo una jornada que una persona puede resolver.
markExit(ctx, { personId: "p2", at: at("16:00"), source: "ADMIN" });
check("un administrador puede cerrarla a mano", dayFor(ctx, "p2", D)!.exit_at, at("16:00").toISOString());
check("y deja de figurar como trabada", blockedAutoCloses(ctx).length, 0);

/* ================================================================== *
 * 3. Entrada posterior al horario: se detiene
 * ================================================================== */

console.log("\n3. Entró después del fin de su horario");

markEntry(ctx, { personId: "p3", at: at("17:00"), source: "ADMIN" });
check("tampoco la cierra", autoCloseOpenDays(ctx, DESPUES), { closed: 0, blocked: 1 });
check("la secuencia sigue empezando por la entrada", vigentes("p3"), ["ENTRY"]);

// Antes quedaba AUTO_EXIT > ENTRY, y entonces esto era imposible.
const entradaTardia = db
  .prepare(`SELECT id FROM attendance_events WHERE person_id='p3' AND voided_at IS NULL LIMIT 1`)
  .get() as unknown as { id: number };
let corregible = true;
try {
  correctMovement(ctx, entradaTardia.id, { time: "09:00", reason: "Hora mal cargada", actor: "t" });
} catch (error) {
  corregible = false;
  console.error("      ", error instanceof MarkError ? error.code : error);
}
check("y el día se puede corregir", corregible, true);
check("con la hora corregida ya cierra sola", autoCloseOpenDays(ctx, DESPUES).closed, 1);

/* ================================================================== *
 * 4. Reparar lo que la versión anterior dejó roto
 * ================================================================== */

console.log("\n4. Reparación de jornadas ya dañadas");

// Se reconstruye el daño insertando los eventos a mano, que es como habían quedado.
markEntry(ctx, { personId: "p4", at: at("09:00"), source: "ADMIN" });
markExit(ctx, { personId: "p4", at: at("10:00"), source: "ADMIN" });
markReentry(ctx, { personId: "p4", at: at("15:00"), source: "ADMIN" });
const dia4 = dayFor(ctx, "p4", D)!;
for (let i = 0; i < 3; i++) {
  db.prepare(
    `INSERT INTO attendance_events (attendance_day_id, person_id, event_type, occurred_at, metadata)
     VALUES (?, 'p4', 'AUTO_EXIT', ?, '{"source":"AUTO"}')`
  ).run(dia4.id, at("12:00").toISOString());
}
check("el daño reconstruido",
  vigentes("p4"), ["ENTRY", "EXIT", "AUTO_EXIT", "AUTO_EXIT", "AUTO_EXIT", "REENTRY"]);

const ensayo = repairAutoCloses(ctx, { dryRun: true });
check("el ensayo dice qué haría", [ensayo.days, ensayo.voided], [1, 3]);
check("pero no toca nada", vigentes("p4").length, 6);

const reparado = repairAutoCloses(ctx, { actor: "TEST" });
check("la reparación anula las tres", [reparado.days, reparado.voided], [1, 3]);
check("y deja la jornada como estaba antes del cierre",
  vigentes("p4"), ["ENTRY", "EXIT", "REENTRY"]);
check("no borra nada: quedan anuladas",
  (db.prepare(
    `SELECT COUNT(*) AS n FROM attendance_events WHERE person_id='p4' AND voided_at IS NOT NULL`
  ).get() as unknown as { n: number }).n, 3);
check("correrla otra vez no hace nada", repairAutoCloses(ctx).days, 0);

// Y el caso de la salida automática antes de la entrada.
markEntry(ctx, { personId: "p5", at: at("18:00"), source: "ADMIN" });
const dia5 = db
  .prepare(`SELECT id FROM attendance_days WHERE person_id='p5' AND work_date=?`)
  .get(D) as unknown as { id: number };
db.prepare(
  `INSERT INTO attendance_events (attendance_day_id, person_id, event_type, occurred_at, metadata)
   VALUES (?, 'p5', 'AUTO_EXIT', ?, '{"source":"AUTO"}')`
).run(dia5.id, at("07:00").toISOString());
check("salida automática antes de la entrada", vigentes("p5"), ["AUTO_EXIT", "ENTRY"]);
const rep2 = repairAutoCloses(ctx, { actor: "TEST" });
check("también se repara", rep2.detail.map((d) => d.problem), ["AUTO_EXIT_ANTES_DE_LA_ENTRADA"]);
check("y la jornada vuelve a empezar por la entrada", vigentes("p5"), ["ENTRY"]);

db.close();

console.log(
  failures === 0
    ? `\n✓ ${checks} comprobaciones, todas correctas.\n`
    : `\n✗ ${failures} de ${checks} comprobaciones fallaron.\n`
);
process.exit(failures === 0 ? 0 : 1);
