/**
 * Prueba del cómputo de días y del registro de licencias contra las cuotas.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/demo-licencias.ts
 */

import { rmSync } from "node:fs";
import { openDatabase } from "@/core/platform/sqlite";
import { initLevel } from "@/core/migrations/level-schema";
import { installPack } from "@/packs/install";
import { computeDays } from "@/core/absence/days";
import { loadAbsenceTypes, consumptionFor } from "@/core/absence/repository";
import { canRegister, evaluateQuota } from "@/core/absence/quota";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

const DIR = "/tmp/sis-a-licencias";
let failures = 0, checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) console.log(`  ✓ ${label}`);
  else { failures += 1; console.error(`  ✗ ${label}\n      esperado: ${b}\n      obtenido: ${a}`); }
}

rmSync(DIR, { recursive: true, force: true });

console.log("\n1. Cómputo de días según el criterio de la norma");

// Del lunes 21/09/2026 al viernes 02/10/2026: 12 corridos, 10 hábiles.
check("días corridos", computeDays({ basis: "CALENDAR", from: "2026-09-21", to: "2026-10-02" }), 12);
check("días hábiles", computeDays({ basis: "BUSINESS", from: "2026-09-21", to: "2026-10-02" }), 10);
check("días hábiles descontando un feriado",
  computeDays({ basis: "BUSINESS", from: "2026-09-21", to: "2026-10-02", holidays: ["2026-09-24"] }), 9);
check("sólo los días con horario asignado",
  computeDays({ basis: "SCHEDULED", from: "2026-09-21", to: "2026-10-02", workingDays: [1, 3, 5] }), 6);
check("un solo día", computeDays({ basis: "CALENDAR", from: "2026-09-22", to: "2026-09-22" }), 1);
check("rango invertido no computa", computeDays({ basis: "CALENDAR", from: "2026-09-22", to: "2026-09-20" }), 0);
check("carga manual", computeDays({ basis: "MANUAL", from: "2026-09-21", to: "2026-10-02", manualDays: 5 }), 5);
// Un fin de semana completo no tiene días hábiles.
check("sábado y domingo sin días hábiles",
  computeDays({ basis: "BUSINESS", from: "2026-09-26", to: "2026-09-27" }), 0);

console.log("\n2. Registro contra la cuota");

const db = openDatabase(`${DIR}/primaria.db`);
initLevel(db);
installPack(db, pack as unknown as Parameters<typeof installPack>[1], "TEST");

const now = new Date().toISOString();
db.prepare(`INSERT INTO people (id,last_name,first_name,national_id,created_at,updated_at) VALUES ('p1','Gómez','Ana','1',?,?)`).run(now, now);

const tipos = loadAbsenceTypes(db);
const art30b = tipos.find((t) => t.code === "ART30B")!;
const art8a = tipos.find((t) => t.code === "ART8A")!;

function registrar(typeId: string, from: string, to: string, days: number, evento?: string) {
  db.prepare(
    `INSERT INTO absence_records (id,person_id,absence_type_id,event_key,date_from,date_to,computed_days,created_by,created_at,updated_at)
     VALUES (?,'p1',?,?,?,?,?,'test',?,?)`
  ).run(crypto.randomUUID(), typeId, evento ?? null, from, to, days, now, now);
}

// Art. 30 inc. b: 6 al año, no más de 2 por mes.
check("con la cuota vacía se puede registrar",
  canRegister(art30b, consumptionFor(db, "p1", art30b.id, "2026-03-05"), 2).allowed, true);

registrar(art30b.id, "2026-03-05", "2026-03-06", 2);
check("agotado el tope mensual, se bloquea",
  canRegister(art30b, consumptionFor(db, "p1", art30b.id, "2026-03-20"), 1).allowed, false);
check("pero el mes siguiente se puede",
  canRegister(art30b, consumptionFor(db, "p1", art30b.id, "2026-04-02"), 2).allowed, true);

registrar(art30b.id, "2026-04-02", "2026-04-03", 2);
registrar(art30b.id, "2026-05-04", "2026-05-05", 2);
check("agotado el tope anual, se bloquea aunque el mes esté libre",
  canRegister(art30b, consumptionFor(db, "p1", art30b.id, "2026-06-01"), 1).allowed, false);

// Art. 8 inc. a: 30 con goce y el resto sin goce, sin tope duro.
registrar(art8a.id, "2026-01-05", "2026-02-03", 30);
const evaluacion = evaluateQuota(art8a, consumptionFor(db, "p1", art8a.id, "2026-06-01"));
check("ART8A con goce agotado", evaluacion.tiers[0].remainingDays, 0);
check("ART8A no bloquea: el excedente va sin goce",
  canRegister(art8a, consumptionFor(db, "p1", art8a.id, "2026-06-01"), 5).allowed, true);
check("y esos días se imputan al tramo sin goce",
  canRegister(art8a, consumptionFor(db, "p1", art8a.id, "2026-06-01"), 5).evaluation.tiers[1].usedDays, 5);

// Los topes por hecho no se cruzan entre episodios distintos.
const art8b = tipos.find((t) => t.code === "ART8B")!;
registrar(art8b.id, "2025-01-01", "2026-12-31", 700, "accidente-2025");
check("un hecho no consume la cuota de otro",
  evaluateQuota(art8b, consumptionFor(db, "p1", art8b.id, "2026-06-01", "accidente-2026")).tiers[0].usedDays, 0);
check("y el hecho propio sí acumula",
  evaluateQuota(art8b, consumptionFor(db, "p1", art8b.id, "2026-06-01", "accidente-2025")).tiers[0].usedDays, 700);

db.close();
console.log(failures === 0 ? `\n✓ ${checks} comprobaciones, todas correctas.` : `\n✗ ${failures} de ${checks} fallaron.`);
process.exit(failures === 0 ? 0 : 1);
