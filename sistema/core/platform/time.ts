/**
 * Tiempo agnóstico de zona horaria.
 *
 * Reemplaza a `lib/time.ts`, que fijaba `America/Argentina/Buenos_Aires`, formateaba en `es-AR`
 * y construía timestamps concatenando el literal `-03:00`. Esa concatenación no es sólo un
 * acoplamiento: produce resultados incorrectos en cualquier zona con horario de verano, porque
 * el offset depende de la fecha.
 *
 * Todas las funciones reciben la zona (y el locale, cuando formatean) de forma explícita. Quien
 * las llama las obtiene del contexto de la organización, nunca de una constante global.
 */

export type TimeZone = string;

export type ZonedParts = {
  /** Fecha local en la zona dada, `YYYY-MM-DD`. */
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO-8601: lunes = 1 … domingo = 7. */
  weekday: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function partsFormatter(timeZone: TimeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
}

/** Descompone un instante en sus componentes locales de `timeZone`. */
export function zonedParts(timeZone: TimeZone, at: Date = new Date()): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    year,
    month,
    day,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/**
 * Offset de `timeZone` en milisegundos para un instante dado.
 * Se calcula comparando la lectura local del instante contra su valor UTC, así que refleja el
 * horario de verano vigente en esa fecha concreta.
 */
export function zoneOffsetMs(timeZone: TimeZone, at: Date): number {
  const parts = partsFormatter(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  // `at` pierde los milisegundos al formatearse; se descuentan para no arrastrar ruido.
  return asIfUtc - (at.getTime() - at.getMilliseconds());
}

/**
 * Convierte una fecha y hora locales de `timeZone` al instante UTC que les corresponde.
 *
 * Sustituye a `isoForArgentinaLocal()`. Hace dos pasadas porque el offset que se necesita para
 * convertir depende del instante resultante: la primera estima, la segunda corrige cuando la
 * fecha cae cerca de un cambio de horario.
 *
 * En el salto de primavera existen horas locales que no ocurren; en el de otoño, horas que
 * ocurren dos veces. En ambos casos se devuelve un instante razonable y determinista.
 */
export function zonedDateTimeToUtc(
  timeZone: TimeZone,
  dateString: string,
  hhmm: string
): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = naive - zoneOffsetMs(timeZone, new Date(naive));
  const corrected = naive - zoneOffsetMs(timeZone, new Date(firstGuess));
  return new Date(corrected);
}

/** Minutos desde la medianoche de un `HH:MM`. */
export function minutesFromHHMM(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

/** `HH:MM` a partir de minutos desde la medianoche. */
export function hhmmFromMinutes(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Minutos transcurridos del día local en `timeZone`. */
export function localMinutesOfDay(timeZone: TimeZone, at: Date = new Date()): number {
  const p = zonedParts(timeZone, at);
  return p.hour * 60 + p.minute;
}

/**
 * Diferencia en minutos entre el momento actual y un horario previsto del mismo día.
 * Positiva si `at` es posterior al horario.
 */
export function minutesFromSchedule(
  timeZone: TimeZone,
  hhmm: string,
  at: Date = new Date()
): number {
  return localMinutesOfDay(timeZone, at) - minutesFromHHMM(hhmm);
}

/** Diferencia en días calendario entre dos fechas `YYYY-MM-DD`, ambas inclusive. */
export function inclusiveCalendarDays(from: string, to: string): number {
  const a = Date.UTC(...(from.split("-").map(Number) as [number, number, number]));
  const b = Date.UTC(...(to.split("-").map(Number) as [number, number, number]));
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function formatDateTime(timeZone: TimeZone, locale: string, value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatTime(
  timeZone: TimeZone,
  locale: string,
  value: Date | string | null | undefined,
  placeholder = "—"
): string {
  if (!value) return placeholder;
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** Valida que la zona sea reconocida por el runtime antes de guardarla en la configuración. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
