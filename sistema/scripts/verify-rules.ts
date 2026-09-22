/**
 * Verificación de equivalencia entre las reglas hardcodeadas y el modelo declarativo.
 *
 * No es un test unitario del núcleo: es la red de seguridad del refactor. Reimplementa aquí,
 * tal cual, la lógica que hoy vive en las rutas de la API, y comprueba que el evaluador
 * declarativo alimentado por `packs/ar-corrientes-dge/pack.json` produce los mismos números.
 *
 *   node --experimental-strip-types scripts/verify-rules.ts
 */

import { evaluateQuota, type AbsenceTypeRule } from "../core/absence/quota.ts";
import { evaluateEntitlement, type EntitlementScale } from "../core/absence/entitlement.ts";
import {
  computeLateness,
  computeClosure,
  type AttendancePolicy,
} from "../core/attendance/policy.ts";
import { zonedDateTimeToUtc, zoneOffsetMs } from "../core/platform/time.ts";
import pack from "../packs/ar-corrientes-dge/pack.json" with { type: "json" };

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures += 1;
    console.error(`  ✗ ${label}\n      esperado: ${b}\n      obtenido: ${a}`);
  }
}

function ruleFor(code: string): AbsenceTypeRule {
  const type = pack.absenceTypes.find((t) => t.code === code);
  if (!type) throw new Error(`El pack no define ${code}`);
  return {
    code: type.code,
    name: type.name,
    reference: type.reference ?? null,
    dayBasis: type.dayBasis as AbsenceTypeRule["dayBasis"],
    tiers: type.tiers.map((tier) => ({
      order: tier.order,
      window: tier.window as AbsenceTypeRule["tiers"][number]["window"],
      limitDays: tier.limitDays,
      payRate: tier.payRate,
      onExhausted: tier.onExhausted as AbsenceTypeRule["tiers"][number]["onExhausted"],
      label: tier.label ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * 1. Saldos de licencias — app/api/admin/leave-balance/route.ts
 * ------------------------------------------------------------------ */

console.log("Saldos de licencias (ART8A, ART12, ART13BIS, ART8B/C)");

for (const used of [0, 1, 5, 15, 19, 20, 21, 29, 30, 31, 39, 40, 41, 100]) {
  // if(code==="ART8A") detail={withPayUsed:Math.min(used,30),remainingWithPay:Math.max(30-used,0),excessWithoutPay:Math.max(used-30,0)};
  const art8a = evaluateQuota(ruleFor("ART8A"), { annual: used });
  expect(`ART8A used=${used} withPayUsed`, art8a.tiers[0].usedDays, Math.min(used, 30));
  expect(`ART8A used=${used} remainingWithPay`, art8a.tiers[0].remainingDays, Math.max(30 - used, 0));
  expect(`ART8A used=${used} excessWithoutPay`, art8a.tiers[1].usedDays, Math.max(used - 30, 0));

  // if(code==="ART12") detail={withPayUsed:…,withoutPayUsed:…,remainingWithPay:…,remainingWithoutPay:…,excess:…};
  const art12 = evaluateQuota(ruleFor("ART12"), { annual: used });
  expect(`ART12 used=${used} withPayUsed`, art12.tiers[0].usedDays, Math.min(used, 20));
  expect(`ART12 used=${used} withoutPayUsed`, art12.tiers[1].usedDays, Math.max(Math.min(used - 20, 20), 0));
  expect(`ART12 used=${used} remainingWithPay`, art12.tiers[0].remainingDays, Math.max(20 - used, 0));
  expect(`ART12 used=${used} remainingWithoutPay`, art12.tiers[1].remainingDays, Math.max(40 - Math.max(used, 20), 0));
  expect(`ART12 used=${used} excess`, art12.excessDays, Math.max(used - 40, 0));
}

for (const used of [0, 7, 14, 15, 16, 25, 30, 31, 45]) {
  // if(code==="ART13BIS") detail={baseUsed:…,extensionUsed:…,remainingBase:…,remainingExtension:…,excess:…};
  const art13bis = evaluateQuota(ruleFor("ART13BIS"), { event: used });
  expect(`ART13BIS used=${used} baseUsed`, art13bis.tiers[0].usedDays, Math.min(used, 15));
  expect(`ART13BIS used=${used} extensionUsed`, art13bis.tiers[1].usedDays, Math.max(Math.min(used - 15, 15), 0));
  expect(`ART13BIS used=${used} remainingBase`, art13bis.tiers[0].remainingDays, Math.max(15 - used, 0));
  expect(`ART13BIS used=${used} remainingExtension`, art13bis.tiers[1].remainingDays, Math.max(30 - Math.max(used, 15), 0));
  expect(`ART13BIS used=${used} excess`, art13bis.excessDays, Math.max(used - 30, 0));
}

for (const used of [0, 365, 729, 730, 731, 1094, 1095, 1096, 1500]) {
  // if(code==="ART8B"||code==="ART8C") detail={fullPayUsed:…,halfPayUsed:…,remainingFullPay:…,remainingHalfPay:…,excess:…};
  for (const code of ["ART8B", "ART8C"]) {
    const rule = evaluateQuota(ruleFor(code), { event: used });
    expect(`${code} used=${used} fullPayUsed`, rule.tiers[0].usedDays, Math.min(used, 730));
    expect(`${code} used=${used} halfPayUsed`, rule.tiers[1].usedDays, Math.max(Math.min(used - 730, 365), 0));
    expect(`${code} used=${used} remainingFullPay`, rule.tiers[0].remainingDays, Math.max(730 - used, 0));
    expect(`${code} used=${used} remainingHalfPay`, rule.tiers[1].remainingDays, Math.max(1095 - Math.max(used, 730), 0));
    expect(`${code} used=${used} excess`, rule.excessDays, Math.max(used - 1095, 0));
  }
}

// Límite anual y mensual simultáneos (Art. 30 inc. b: 6 al año, no más de 2 por mes).
for (const [annual, monthly] of [[0, 0], [3, 1], [5, 2], [6, 2], [6, 3], [2, 2]]) {
  const art30b = evaluateQuota(ruleFor("ART30B"), { annual, monthly });
  expect(`ART30B anual=${annual} remainingAnnual`, art30b.tiers[0].remainingDays, Math.max(6 - annual, 0));
  expect(`ART30B mensual=${monthly} remainingMonthly`, art30b.tiers[1].remainingDays, Math.max(2 - monthly, 0));
  // Manda la ventana más restrictiva.
  expect(
    `ART30B anual=${annual} mensual=${monthly} disponible`,
    art30b.totalRemainingDays,
    Math.min(Math.max(6 - annual, 0), Math.max(2 - monthly, 0))
  );
  // Agotar la cuota justo es válido; lo que bloquea es excederla.
  expect(`ART30B anual=${annual} mensual=${monthly} bloqueado`, art30b.blocked, annual > 6 || monthly > 2);
}

/* ------------------------------------------------------------------ *
 * 2. Vacaciones — app/api/admin/vacation-status/route.ts
 * ------------------------------------------------------------------ */

console.log("Escala de vacaciones (Arts. 4 y 5)");

function legacyBaseDays(years: number) {
  return years <= 5 ? 20 : years <= 10 ? 25 : years <= 15 ? 30 : 35;
}
function legacyEntitlement(years: number, months: number, extra: boolean) {
  const base = legacyBaseDays(years);
  if (months >= 6) return base;
  const units = Math.min(12, Math.max(0, months) + (extra ? 1 : 0));
  return Math.round(((base / 12) * units) * 100) / 100;
}

const scaleSource = pack.entitlementScales.find((s) => s.code === "VACATION")!;
const scale: EntitlementScale = {
  code: scaleSource.code,
  name: scaleSource.name,
  basis: scaleSource.basis as EntitlementScale["basis"],
  proration: scaleSource.proration as EntitlementScale["proration"],
  fullAfterMonths: scaleSource.fullAfterMonths,
  extraFractionOverDays: scaleSource.extraFractionOverDays,
  tiers: scaleSource.tiers,
};

for (let years = 0; years <= 40; years++) {
  for (const months of [0, 1, 3, 5, 6, 7, 12]) {
    for (const extra of [false, true]) {
      expect(
        `vacaciones años=${years} meses=${months} fracción=${extra}`,
        evaluateEntitlement(scale, { basisValue: years, serviceMonths: months, hasExtraFraction: extra })
          .entitlementDays,
        legacyEntitlement(years, months, extra)
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3. Asistencia — lib/attendance.ts
 * ------------------------------------------------------------------ */

console.log("Política de asistencia (tolerancia, compensación)");

const policySource = pack.attendancePolicies[0];
const policy: AttendancePolicy = {
  code: policySource.code,
  name: policySource.name,
  latenessToleranceMinutes: policySource.latenessToleranceMinutes,
  latenessMode: policySource.latenessMode as AttendancePolicy["latenessMode"],
  countEarlyExit: policySource.countEarlyExit,
  compensationMode: policySource.compensationMode as AttendancePolicy["compensationMode"],
  autoCloseMode: policySource.autoCloseMode as AttendancePolicy["autoCloseMode"],
  autoCloseGraceMinutes: policySource.autoCloseGraceMinutes,
  movementSequence: policySource.movementSequence as AttendancePolicy["movementSequence"],
  countingStartDate: policySource.countingStartDate,
};

for (const rawLate of [-10, 0, 1, 14, 15, 16, 30, 120]) {
  // const lateMinutes = rawLate > tolerance ? rawLate : 0;   (tolerance = 15)
  const legacy = Math.max(0, rawLate) > 15 ? Math.max(0, rawLate) : 0;
  expect(`tardanza raw=${rawLate}`, computeLateness(policy, rawLate), legacy);
}

// La regla habitual en otros organismos: se descuenta la tolerancia.
const graceOnly: AttendancePolicy = { ...policy, latenessMode: "GRACE_ONLY" };
expect("GRACE_ONLY raw=16", computeLateness(graceOnly, 16), 1);
expect("GRACE_ONLY raw=45", computeLateness(graceOnly, 45), 30);

for (const [late, after, early] of [[0, 0, 0], [20, 0, 0], [20, 10, 0], [20, 30, 0], [0, 0, 25], [20, 5, 0]]) {
  // registerExit(): compensation = min(late, after); pending = max(0, late - compensation) + early
  const compensation = Math.min(late, after);
  const pending = Math.max(0, late - compensation) + early;
  const result = computeClosure(policy, {
    lateMinutes: late,
    minutesAfterScheduledEnd: after,
    earlyExitMinutes: early,
  });
  expect(`cierre late=${late} after=${after} early=${early} compensación`, result.compensationMinutes, compensation);
  expect(`cierre late=${late} after=${after} early=${early} pendiente`, result.pendingMinutes, pending);
}

/* ------------------------------------------------------------------ *
 * 4. Zona horaria — lib/time.ts
 * ------------------------------------------------------------------ */

console.log("Conversión de hora local a UTC");

// En Argentina, que no aplica horario de verano, el resultado debe coincidir con el literal
// `-03:00` que concatenaba isoForArgentinaLocal().
for (const date of ["2026-01-15", "2026-07-15", "2026-09-22", "2026-12-31"]) {
  const legacy = new Date(`${date}T17:30:00-03:00`).toISOString();
  const next = zonedDateTimeToUtc("America/Argentina/Buenos_Aires", date, "17:30").toISOString();
  expect(`AR ${date} 17:30`, next, legacy);
}

// En una zona con horario de verano, la constante `-03:00` fallaría: aquí se comprueba que el
// offset se calcula por fecha. Santiago de Chile: UTC-4 en invierno austral, UTC-3 en verano.
const winter = zoneOffsetMs("America/Santiago", new Date("2026-07-15T12:00:00Z")) / 3_600_000;
const summer = zoneOffsetMs("America/Santiago", new Date("2026-01-15T12:00:00Z")) / 3_600_000;
expect("Santiago julio offset", winter, -4);
expect("Santiago enero offset", summer, -3);
expect(
  "Santiago 15/07 09:00 local",
  zonedDateTimeToUtc("America/Santiago", "2026-07-15", "09:00").toISOString(),
  "2026-07-15T13:00:00.000Z"
);
expect(
  "Santiago 15/01 09:00 local",
  zonedDateTimeToUtc("America/Santiago", "2026-01-15", "09:00").toISOString(),
  "2026-01-15T12:00:00.000Z"
);

/* ------------------------------------------------------------------ */

console.log(
  failures === 0
    ? `\n✓ ${checks} comprobaciones, todas equivalentes.`
    : `\n✗ ${failures} de ${checks} comprobaciones fallaron.`
);
process.exit(failures === 0 ? 0 : 1);
