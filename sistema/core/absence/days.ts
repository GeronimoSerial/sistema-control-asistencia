/**
 * Cómputo de días de una ausencia.
 *
 * Cuántos días consume una licencia no es una cuenta obvia: depende de cómo la norma cuente los
 * días. El Estatuto usa tres criterios distintos —corridos, hábiles, y "los que correspondía
 * trabajar"— y el sistema anterior los tenía declarados en el catálogo pero no los calculaba:
 * el número lo cargaba a mano quien registraba la licencia.
 */

export type DayBasis = "CALENDAR" | "BUSINESS" | "SCHEDULED" | "MANUAL";

/** Días de la semana que la persona tiene asignados. Lunes = 1, domingo = 7. */
export type WorkingDays = number[];

/** Día ISO de una fecha civil: lunes = 1, domingo = 7. */
export function isoWeekday(date: string): number {
  // Se usa el mediodía UTC para que ningún desplazamiento de zona corra la fecha un día.
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Recorre las fechas civiles de un rango, ambas inclusive. */
export function* eachDate(from: string, to: string): Generator<string> {
  const end = new Date(`${to}T12:00:00Z`).getTime();
  let cursor = new Date(`${from}T12:00:00Z`).getTime();
  while (cursor <= end) {
    yield new Date(cursor).toISOString().slice(0, 10);
    cursor += 86_400_000;
  }
}

export type ComputeDaysInput = {
  basis: DayBasis;
  from: string;
  to: string;
  /** Días con horario asignado. Necesario sólo para `SCHEDULED`. */
  workingDays?: WorkingDays;
  /** Fechas `YYYY-MM-DD` no laborables. Se descuentan en `BUSINESS` y `SCHEDULED`. */
  holidays?: string[];
  /** Valor cargado a mano, para `MANUAL`. */
  manualDays?: number;
};

/**
 * Días que consume la ausencia.
 *
 * - `CALENDAR`: días corridos, incluidos fines de semana y feriados.
 * - `BUSINESS`: días hábiles, de lunes a viernes, descontando feriados.
 * - `SCHEDULED`: sólo los días en que la persona tenía que trabajar.
 * - `MANUAL`: lo que se haya cargado; el sistema no cuenta.
 */
export function computeDays(input: ComputeDaysInput): number {
  if (input.to < input.from) return 0;
  if (input.basis === "MANUAL") return Math.max(0, input.manualDays ?? 0);

  const holidays = new Set(input.holidays ?? []);
  let total = 0;

  for (const date of eachDate(input.from, input.to)) {
    if (input.basis === "CALENDAR") {
      total += 1;
      continue;
    }
    if (holidays.has(date)) continue;

    const weekday = isoWeekday(date);
    if (input.basis === "BUSINESS" && weekday <= 5) total += 1;
    if (input.basis === "SCHEDULED" && (input.workingDays ?? []).includes(weekday)) total += 1;
  }

  return total;
}

export const BASIS_LABELS: Record<DayBasis, string> = {
  CALENDAR: "días corridos",
  BUSINESS: "días hábiles",
  SCHEDULED: "días con horario asignado",
  MANUAL: "carga manual",
};
