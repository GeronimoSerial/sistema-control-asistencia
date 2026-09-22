/**
 * Cadena de validación de una marcación.
 *
 * El orden importa y es deliberado: QR vigente, PIN válido, dispositivo autorizado y recién
 * entonces ubicación. Así nadie puede usar la pantalla para averiguar si un PIN existe sin tener
 * primero un código vigente, y el mensaje de "fuera del radio" sólo lo ve quien ya se identificó.
 */

import {
  validateQrToken,
  findPersonByPin,
  checkDevice,
  validateLocation,
  type Person,
  type Coordinates,
} from "@/core/attendance/service";
import { resolveLevel, mainLocation, type ResolvedLevel } from "@/lib/levels";

export type MarkRequestBody = {
  token?: string;
  pin?: string;
  deviceKey?: string;
  coordinates?: Coordinates | null;
  action?: string;
};

export type AuthorizeFailure = { ok: false; status: number; code: string; message: string };
export type AuthorizeSuccess = {
  ok: true;
  resolved: ResolvedLevel;
  location: { id: string; name: string };
  person: Person;
  distance: number | null;
  deviceBoundNow: boolean;
};

const MESSAGES: Record<string, string> = {
  LEVEL_NOT_FOUND: "El nivel indicado no existe.",
  NO_LOCATION: "El nivel todavía no tiene una sede configurada.",
  INVALID_QR: "El código QR venció. Volvé a escanearlo desde la pantalla.",
  INVALID_PIN: "El PIN no es correcto o está vencido.",
  DEVICE_USED_BY_OTHER: "Este teléfono ya está vinculado a otra persona.",
  OTHER_DEVICE_AUTHORIZED: "Tenés otro teléfono autorizado. Pedí en Administración que lo desvinculen.",
  LOCATION_NOT_CONFIGURED: "La sede no tiene ubicación configurada.",
  OUTSIDE_RADIUS: "Estás fuera del área de la oficina.",
  NO_COORDINATES: "No se pudo obtener tu ubicación. Revisá los permisos del navegador.",
};

function fail(status: number, code: string): AuthorizeFailure {
  return { ok: false, status, code, message: MESSAGES[code] ?? "No se pudo completar la operación." };
}

export async function authorizeMarking(
  nivel: string,
  body: MarkRequestBody,
  options: { bindDevice?: boolean } = {}
): Promise<AuthorizeSuccess | AuthorizeFailure> {
  const resolved = resolveLevel(nivel);
  if (!resolved) return fail(404, "LEVEL_NOT_FOUND");

  const location = mainLocation(resolved.context.db);
  if (!location) return fail(409, "NO_LOCATION");

  if (!body.token || !validateQrToken(resolved.context, body.token)) {
    return fail(401, "INVALID_QR");
  }

  const pin = String(body.pin ?? "").trim();
  if (!pin) return fail(401, "INVALID_PIN");
  const person = await findPersonByPin(resolved.context, pin);
  if (!person) return fail(401, "INVALID_PIN");

  const deviceKey = String(body.deviceKey ?? "").trim();
  if (deviceKey.length < 16) return fail(400, "INVALID_QR");
  const device = checkDevice(resolved.context, person.id, deviceKey, {
    bindIfMissing: options.bindDevice === true,
  });
  if (!device.ok) return fail(403, device.reason);

  if (!body.coordinates) return fail(400, "NO_COORDINATES");
  const geo = validateLocation(resolved.context, location.id, body.coordinates);
  if (!geo.ok) return fail(403, geo.reason ?? "OUTSIDE_RADIUS");

  return {
    ok: true,
    resolved,
    location: { id: location.id, name: location.name },
    person,
    distance: geo.distance,
    deviceBoundNow: device.boundNow,
  };
}

export const ACTION_LABELS: Record<string, string> = {
  ENTRY: "Registrar entrada",
  EXIT: "Registrar salida",
  REENTRY: "Registrar reingreso",
};

export const BLOCK_MESSAGES: Record<string, string> = {
  NO_SCHEDULE: "No tenés horario asignado para hoy.",
  ON_ABSENCE: "Figurás con una licencia vigente para hoy.",
  DAY_CLOSED: "Tu jornada de hoy ya está cerrada.",
};
