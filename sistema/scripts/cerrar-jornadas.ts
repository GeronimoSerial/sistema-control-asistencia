/**
 * Cierre automático de jornadas, para todos los niveles activos.
 *
 * Nada en la aplicación lo llamaba: la función existía y no se ejecutaba nunca. Este guion es lo
 * que hay que poner en el programador de tareas del servidor, una vez por día después del último
 * horario de salida.
 *
 *   npm run jornadas:cerrar
 *   npm run jornadas:cerrar -- --reparar   (además repara lo que dañó la versión anterior)
 *
 * Con `--reparar` anula las salidas automáticas que el cierve viejo apiló o dejó antes de la
 * entrada. Es idempotente y no inventa ninguna salida: las jornadas afectadas vuelven a quedar
 * abiertas, para que alguien las resuelva desde Registros.
 */

import { openDatabase } from "@/core/platform/sqlite";
import { initPlatform, listLevels } from "@/core/tenancy/levels";
import { initLevel } from "@/core/migrations/level-schema";
import { getSetting } from "@/core/config/store";
import { NEUTRAL_POLICY, type AttendancePolicy } from "@/core/attendance/policy";
import { autoCloseOpenDays, blockedAutoCloses, type LevelContext } from "@/core/attendance/service";
import { repairAutoCloses } from "@/core/attendance/repair";

const reparar = process.argv.includes("--reparar");
const dataDir = process.env.DATA_DIR ?? "./data";
const secret = process.env.AUTH_SECRET ?? "x".repeat(32);

const platform = openDatabase(`${dataDir}/platform.db`);
initPlatform(platform);

const niveles = listLevels(platform, true);
if (!niveles.length) {
  console.log("No hay niveles activos.");
  process.exit(0);
}

for (const level of niveles) {
  const db = openDatabase(level.databaseFile);
  initLevel(db);

  const row = db.prepare(`SELECT * FROM attendance_policies WHERE is_default = 1`).get() as
    unknown as Record<string, string | number | null> | undefined;
  const policy: AttendancePolicy = row
    ? {
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
      }
    : NEUTRAL_POLICY;

  const ctx: LevelContext = {
    db,
    timeZone: getSetting<string>(db, "locale.time_zone") || level.timeZone,
    policy,
    secret,
  };

  console.log(`\n${level.name} (${level.slug})`);

  if (reparar) {
    const repaired = repairAutoCloses(ctx, { actor: "CLI" });
    if (repaired.days) {
      console.log(`  reparadas: ${repaired.days} jornadas, ${repaired.voided} salidas anuladas`);
      for (const d of repaired.detail) console.log(`    ${d.workDate} · ${d.problem} (${d.voided})`);
    } else {
      console.log("  reparación: no había nada que reparar");
    }
  }

  if (policy.autoCloseMode === "NONE") {
    console.log("  el cierre automático está desactivado en la política de este nivel");
  } else {
    const { closed, blocked } = autoCloseOpenDays(ctx);
    console.log(`  cerradas: ${closed}${blocked ? ` · sin poder cerrar: ${blocked}` : ""}`);
  }

  const pendientes = blockedAutoCloses(ctx);
  for (const p of pendientes) {
    console.log(`    ⚠ ${p.work_date} · ${p.person}: esperando resolución manual`);
  }

  db.close();
}

platform.close();
console.log();
