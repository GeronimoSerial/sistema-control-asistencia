/**
 * Corrección y anulación de movimientos ya registrados.
 *
 * Lo que se prueba acá no es que las funciones escriban lo que se les pide, sino que **no dejen la
 * jornada en un estado imposible**. Marcar encadena: cada marcación mira la anterior. Corregir
 * puede entrar por el medio, y si nadie mira el resultado se puede llegar a un día con dos
 * entradas, con una salida antes de la entrada, o sin entrada pero con salida. `recomputeDay()`
 * leería cualquiera de esos como si fuera un día normal y devolvería números sin sentido.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/demo-correcciones.ts
 */

import { rmSync } from "node:fs";
import { openDatabase } from "@/core/platform/sqlite";
import { initLevel } from "@/core/migrations/level-schema";
import { installPack } from "@/packs/install";
import type { AttendancePolicy } from "@/core/attendance/policy";
import {
  markEntry, markExit, markReentry, dayFor, correctMovement, voidMovement,
  sequenceProblem, pendingIntervals, classifyInterval, MarkError, type LevelContext,
} from "@/core/attendance/service";
import { zonedDateTimeToUtc } from "@/core/platform/time";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

const DATA_DIR = "/tmp/sis-a-correcciones";
const ZONE = "America/Argentina/Buenos_Aires";
const ACTOR = "admin@nivel";
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

console.log("\n1. Nivel con la política del paquete");

const db = openDatabase(`${DATA_DIR}/primaria.db`);
initLevel(db);
installPack(db, pack as unknown as Parameters<typeof installPack>[1], "INSTALADOR");

const row = db.prepare(`SELECT * FROM attendance_policies WHERE is_default = 1`).get() as
  unknown as Record<string, string | number | null>;
const policy: AttendancePolicy = {
  code: String(row.code),
  name: String(row.name),
  latenessToleranceMinutes: Number(row.lateness_tolerance_minutes),
  latenessMode: String(row.lateness_mode) as AttendancePolicy["latenessMode"],
  countEarlyExit: row.count_early_exit === 1,
  compensationMode: String(row.compensation_mode) as AttendancePolicy["compensationMode"],
  autoCloseMode: String(row.auto_close_mode) as AttendancePolicy["autoCloseMode"],
  autoCloseGraceMinutes: Number(row.auto_close_grace_minutes),
  movementSequence: String(row.movement_sequence) as AttendancePolicy["movementSequence"],
  countingStartDate: row.counting_start_date ? String(row.counting_start_date) : null,
};

const ctx: LevelContext = { db, timeZone: ZONE, policy, secret: "x".repeat(32) };

const now = new Date().toISOString();
db.prepare(
  `INSERT INTO people (id, last_name, first_name, national_id, employment, created_at, updated_at)
   VALUES ('p1','Gómez','Ana','20111222','TITULAR',?,?)`
).run(now, now);
for (const weekday of [1, 2, 3, 4, 5]) {
  db.prepare(
    `INSERT INTO person_schedules (person_id, weekday, start_time, end_time) VALUES ('p1',?,'08:00','14:00')`
  ).run(weekday);
}

/** Un lunes cualquiera, para que haya horario. */
const DATE = "2026-03-02";
const at = (hhmm: string) => zonedDateTimeToUtc(ZONE, DATE, hhmm);
const movimientos = () =>
  db
    .prepare(
      `SELECT id, event_type, occurred_at, voided_at FROM attendance_events
       WHERE person_id = 'p1' ORDER BY occurred_at, id`
    )
    .all() as unknown as { id: number; event_type: string; occurred_at: string; voided_at: string | null }[];
const vigentes = () => movimientos().filter((m) => m.voided_at === null);
const jornada = () => dayFor(ctx, "p1", DATE)!;

check("política MULTI con tolerancia de 15", [policy.movementSequence, policy.latenessToleranceMinutes],
  ["MULTI", 15]);

/* ================================================================== *
 * 2. El validador de secuencia, aislado
 * ================================================================== */

console.log("\n2. Qué secuencias son posibles");

const seq = (...types: string[]) =>
  types.map((event_type, index) => ({
    event_type,
    occurred_at: `2026-03-02T1${index}:00:00.000Z`,
  }));

check("un día vacío es válido", sequenceProblem([], policy), null);
check("entrada y salida", sequenceProblem(seq("ENTRY", "EXIT"), policy), null);
check("entrada, salida, reingreso y salida",
  sequenceProblem(seq("ENTRY", "EXIT", "REENTRY", "EXIT"), policy), null);
check("no puede empezar por una salida",
  sequenceProblem(seq("EXIT"), policy), "MUST_START_WITH_ENTRY");
check("no puede haber dos entradas",
  sequenceProblem(seq("ENTRY", "ENTRY"), policy), "DUPLICATE_ENTRY");
check("no puede haber dos salidas seguidas",
  sequenceProblem(seq("ENTRY", "EXIT", "EXIT"), policy), "OUT_OF_ORDER");
check("no puede haber dos reingresos seguidos",
  sequenceProblem(seq("ENTRY", "EXIT", "REENTRY", "REENTRY"), policy), "OUT_OF_ORDER");
check("el cierre automático cierra igual que una salida",
  sequenceProblem(seq("ENTRY", "AUTO_EXIT"), policy), null);
check("dos movimientos en el mismo instante no son distinguibles",
  sequenceProblem(
    [
      { event_type: "ENTRY", occurred_at: "2026-03-02T11:00:00.000Z" },
      { event_type: "EXIT", occurred_at: "2026-03-02T11:00:00.000Z" },
    ],
    policy
  ),
  "SAME_INSTANT");
check("con política SIMPLE no se admite un reingreso",
  sequenceProblem(seq("ENTRY", "EXIT", "REENTRY"), { ...policy, movementSequence: "SIMPLE" }),
  "REENTRY_NOT_ALLOWED");

/* ================================================================== *
 * 3. Corregir la hora de una entrada
 * ================================================================== */

console.log("\n3. La entrada se cargó una hora tarde");

markEntry(ctx, { personId: "p1", at: at("09:30"), source: "ADMIN" });
check("entrada con 90 minutos de tardanza", jornada().late_minutes, 90);

const entrada = vigentes()[0];
correctMovement(ctx, entrada.id, { time: "08:10", reason: "Hora mal cargada", actor: ACTOR });

// 10 minutos caen dentro de la tolerancia de 15: la tardanza desaparece, no se reduce.
check("corregida a 08:10 la tardanza se absorbe", jornada().late_minutes, 0);
check("la jornada apunta a la hora corregida",
  jornada().entry_at, at("08:10").toISOString());

const corregida = db
  .prepare(`SELECT original_occurred_at, corrected_by, correction_reason FROM attendance_events WHERE id = ?`)
  .get(entrada.id) as unknown as {
    original_occurred_at: string; corrected_by: string; correction_reason: string;
  };
check("guarda la hora original", corregida.original_occurred_at, at("09:30").toISOString());
check("y quién la corrigió", [corregida.corrected_by, corregida.correction_reason],
  [ACTOR, "Hora mal cargada"]);

// 20 minutos pasan la tolerancia, y con FULL_FROM_SCHEDULED cuentan completos desde el horario
// previsto: 20, no 5.
correctMovement(ctx, entrada.id, { time: "08:20", reason: "Segunda corrección", actor: ACTOR });
check("corregida a 08:20 cuenta la tardanza entera", jornada().late_minutes, 20);

const dosVeces = db
  .prepare(`SELECT original_occurred_at FROM attendance_events WHERE id = ?`)
  .get(entrada.id) as unknown as { original_occurred_at: string };
check("una segunda corrección no pisa la hora original",
  dosVeces.original_occurred_at, at("09:30").toISOString());

check("queda asentado en la auditoría",
  (db.prepare(
    `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'attendance.movement.correct'`
  ).get() as unknown as { n: number }).n, 2);

/* ================================================================== *
 * 4. Lo que la corrección no puede romper
 * ================================================================== */

console.log("\n4. Correcciones rechazadas");

markExit(ctx, { personId: "p1", at: at("10:00"), source: "ADMIN" });
markReentry(ctx, { personId: "p1", at: at("11:00"), source: "ADMIN" });
markExit(ctx, { personId: "p1", at: at("14:00"), source: "ADMIN" });

const [e1, s1, r1, s2] = vigentes();
check("cuatro movimientos vigentes",
  vigentes().map((m) => m.event_type), ["ENTRY", "EXIT", "REENTRY", "EXIT"]);

// Llevar la entrada más allá de la primera salida deja el día empezando por una salida.
expectError("la entrada no puede pasar por detrás de la primera salida",
  () => correctMovement(ctx, e1.id, { time: "10:30", reason: "x", actor: ACTOR }),
  "MUST_START_WITH_ENTRY");
expectError("el reingreso no puede adelantarse a la salida que lo precede",
  () => correctMovement(ctx, r1.id, { time: "09:00", reason: "x", actor: ACTOR }), "OUT_OF_ORDER");
expectError("no se puede pisar la hora de otro movimiento",
  () => correctMovement(ctx, s1.id, { time: "11:00", reason: "x", actor: ACTOR }), "SAME_INSTANT");
expectError("la corrección necesita un motivo",
  () => correctMovement(ctx, s2.id, { time: "13:50", reason: "   ", actor: ACTOR }), "REASON_REQUIRED");
expectError("un movimiento inexistente no se corrige",
  () => correctMovement(ctx, 9999, { time: "13:50", reason: "x", actor: ACTOR }), "EVENT_NOT_FOUND");

check("nada de eso cambió los movimientos",
  vigentes().map((m) => m.occurred_at),
  [at("08:20"), at("10:00"), at("11:00"), at("14:00")].map((d) => d.toISOString()));

/* ================================================================== *
 * 5. El intervalo sigue a los movimientos
 * ================================================================== */

console.log("\n5. La salida intermedia acompaña la corrección");

const intervalo = () =>
  db
    .prepare(`SELECT * FROM attendance_intervals WHERE person_id = 'p1' ORDER BY id LIMIT 1`)
    .get() as unknown as {
      id: number; exited_at: string; reentered_at: string | null;
      counts_as_work: number | null; voided_at: string | null;
    };

check("el intervalo va de 10:00 a 11:00",
  [intervalo().exited_at, intervalo().reentered_at],
  [at("10:00").toISOString(), at("11:00").toISOString()]);

correctMovement(ctx, s1.id, { time: "10:20", reason: "Salió más tarde", actor: ACTOR });
check("corregir la salida mueve el inicio del intervalo",
  intervalo().exited_at, at("10:20").toISOString());
correctMovement(ctx, r1.id, { time: "11:30", reason: "Volvió más tarde", actor: ACTOR });
check("corregir el reingreso mueve el fin del intervalo",
  intervalo().reentered_at, at("11:30").toISOString());

classifyInterval(ctx, intervalo().id, {
  reasonCode: "PERSONAL", countsAsWork: false, actor: ACTOR,
});
check("el intervalo quedó clasificado", intervalo().counts_as_work, 0);

/* ================================================================== *
 * 6. Anular
 * ================================================================== */

console.log("\n6. Anulación, del último hacia atrás");

expectError("no se puede anular la entrada dejando el resto del día",
  () => voidMovement(ctx, e1.id, { reason: "x", actor: ACTOR }), "MUST_START_WITH_ENTRY");
expectError("ni la salida intermedia dejando el reingreso colgado",
  () => voidMovement(ctx, s1.id, { reason: "x", actor: ACTOR }), "OUT_OF_ORDER");
expectError("la anulación también necesita un motivo",
  () => voidMovement(ctx, s2.id, { reason: "", actor: ACTOR }), "REASON_REQUIRED");

voidMovement(ctx, s2.id, { reason: "Salida duplicada", actor: ACTOR });
check("la salida final se anuló",
  vigentes().map((m) => m.event_type), ["ENTRY", "EXIT", "REENTRY"]);
check("la fila sigue en la base", movimientos().length, 4);
check("la jornada vuelve a estar abierta", jornada().exit_at, null);
check("y lo adeudado vuelve a ser sólo la tardanza",
  [jornada().late_minutes, jornada().pending_minutes], [20, 20]);

expectError("no se anula dos veces",
  () => voidMovement(ctx, s2.id, { reason: "x", actor: ACTOR }), "ALREADY_VOIDED");
expectError("ni se corrige lo anulado",
  () => correctMovement(ctx, s2.id, { time: "13:00", reason: "x", actor: ACTOR }), "EVENT_VOIDED");

voidMovement(ctx, r1.id, { reason: "Reingreso que no existió", actor: ACTOR });
check("anular el reingreso reabre el intervalo",
  [intervalo().reentered_at, intervalo().counts_as_work],
  [null, null]);
check("y el intervalo reabierto no figura como pendiente de clasificar",
  pendingIntervals(ctx, DATE).length, 0);

voidMovement(ctx, s1.id, { reason: "Salida que no existió", actor: ACTOR });
check("anular la salida anula su intervalo", intervalo().voided_at !== null, true);
check("ahora sí se puede anular la entrada",
  (() => { voidMovement(ctx, e1.id, { reason: "Jornada entera equivocada", actor: ACTOR }); return vigentes().length; })(),
  0);
check("la jornada quedó sin entrada ni salida",
  [jornada().entry_at, jornada().exit_at, jornada().late_minutes], [null, null, 0]);
check("los cuatro movimientos siguen guardados", movimientos().length, 4);

/* ================================================================== *
 * 7. Después de anular todo se puede volver a cargar
 * ================================================================== */

console.log("\n7. La jornada se puede rehacer");

markEntry(ctx, { personId: "p1", at: at("08:00"), source: "ADMIN" });
check("entra sin tardanza", jornada().late_minutes, 0);
check("y hay un solo movimiento vigente",
  vigentes().map((m) => m.event_type), ["ENTRY"]);

db.close();

/* ================================================================== *
 * 8. La base que ya existía
 * ================================================================== */

console.log("\n8. Una base creada antes de la corrección se migra sola");

// `CREATE TABLE IF NOT EXISTS` no toca una tabla existente, así que las columnas nuevas no
// llegarían a las bases que ya están en uso. Acá se reconstruye ese caso —se quitan las columnas
// y se restituye el índice viejo— y se comprueba que abrir el nivel las repone.
const AGREGADAS = [
  "voided_at", "voided_by", "void_reason", "original_occurred_at",
  "corrected_by", "corrected_at", "correction_reason",
];

rmSync(`${DATA_DIR}/vieja.db`, { force: true });
const vieja = openDatabase(`${DATA_DIR}/vieja.db`);
initLevel(vieja);

for (const column of AGREGADAS) vieja.exec(`ALTER TABLE attendance_events DROP COLUMN ${column}`);
vieja.exec(`DROP INDEX IF EXISTS idx_intervals_open`);
vieja.exec(`ALTER TABLE attendance_intervals DROP COLUMN voided_at`);
vieja.exec(
  `CREATE UNIQUE INDEX idx_intervals_open
     ON attendance_intervals(attendance_day_id) WHERE reentered_at IS NULL`
);

const columnasDe = (table: string) =>
  (vieja.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[])
    .map((column) => column.name);

check("la base simulada no tiene las columnas nuevas",
  AGREGADAS.some((column) => columnasDe("attendance_events").includes(column)), false);

initLevel(vieja);

check("al abrir el nivel se agregan las siete",
  AGREGADAS.every((column) => columnasDe("attendance_events").includes(column)), true);
check("y la de los intervalos", columnasDe("attendance_intervals").includes("voided_at"), true);
check("el índice de intervalo abierto contempla los anulados",
  (vieja.prepare(`SELECT sql FROM sqlite_master WHERE name = 'idx_intervals_open'`)
    .get() as unknown as { sql: string }).sql.includes("voided_at IS NULL"), true);

initLevel(vieja);
check("y volver a abrirla no rompe nada",
  columnasDe("attendance_events").filter((column) => column === "voided_at").length, 1);

vieja.close();

console.log(
  failures === 0
    ? `\n✓ ${checks} comprobaciones, todas correctas.\n`
    : `\n✗ ${failures} de ${checks} comprobaciones fallaron.\n`
);
process.exit(failures === 0 ? 0 : 1);
