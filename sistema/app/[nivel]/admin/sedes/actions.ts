"use server";

import { revalidatePath } from "next/cache";
import { sessionWith } from "@/lib/session";
import {
  createLocation,
  updateLocation,
  setLocationActive,
  LocationError,
} from "@/core/attendance/locations";
import { allDefinitions, validateSetting } from "@/core/config/definitions";
import { setSetting } from "@/core/config/store";
import { type ActionState } from "./shared";

function fail(error: string): ActionState {
  return { error, message: null };
}

const LOCATION_ERRORS: Record<string, string> = {
  NAME_REQUIRED: "La sede necesita un nombre.",
  CODE_TOO_SHORT: "El código es demasiado corto.",
  CODE_TAKEN: "Ya hay otra sede con ese código.",
  COORDINATES_INCOMPLETE: "Cargá la latitud y la longitud, o dejá las dos vacías.",
  LATITUDE_INVALID: "La latitud no es válida.",
  LONGITUDE_INVALID: "La longitud no es válida.",
  NOT_FOUND: "La sede ya no existe.",
  LAST_LOCATION: "Es la única sede activa: sin ninguna no se puede marcar.",
};

function coordinate(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  // `NaN` no es `null`: si escribieron algo que no es un número hay que avisarlo, no ignorarlo.
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Crea o modifica una sede, y de paso guarda los parámetros que tienen ámbito de sede.
 *
 * Esos parámetros —radio de la geocerca, exigencia de ubicación, vigencia del QR— estaban en la
 * pantalla de configuración aplicándose siempre a «la primera sede activa». Con una sola sede eso
 * funcionaba por casualidad. Acá cada sede guarda los suyos, que es lo que el ámbito `LOCATION`
 * decía desde el principio.
 */
export async function guardarSede(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "settings.write");
  if (!session) return fail("No tenés permiso para administrar las sedes.");

  const id = String(formData.get("id") ?? "").trim();
  const nombre = String(formData.get("nombre") ?? "").trim();
  const codigo = String(formData.get("codigo") ?? "").trim();
  const lat = coordinate(formData.get("lat"));
  const lng = coordinate(formData.get("lng"));
  if (Number.isNaN(lat) || Number.isNaN(lng)) return fail("Las coordenadas deben ser números.");

  const { db } = session.resolved.context;
  const input = { code: codigo, name: nombre, latitude: lat, longitude: lng };

  let locationId: string;
  let creada = false;
  try {
    if (id) {
      locationId = updateLocation(db, id, input).id;
    } else {
      locationId = createLocation(db, input).id;
      creada = true;
    }
  } catch (error) {
    if (error instanceof LocationError) {
      return fail(LOCATION_ERRORS[error.code] ?? "No se pudo guardar la sede.");
    }
    throw error;
  }

  // Los parámetros de sede se validan todos antes de escribir ninguno: uno inválido cancela el
  // lote, para no dejar la sede a medio configurar.
  const definitions = allDefinitions().filter((definition) => definition.scope === "LOCATION");
  const validated: { key: string; value: unknown }[] = [];
  const errores: string[] = [];

  for (const definition of definitions) {
    const raw =
      definition.type === "boolean"
        ? formData.get(definition.key) === "on"
        : formData.get(definition.key);
    if (raw === null) continue;
    const result = validateSetting(definition.key, raw);
    if (!result.ok) errores.push(`${definition.label}: ${result.error}`);
    else validated.push({ key: definition.key, value: result.value });
  }

  if (errores.length) return fail(errores.join(" · "));
  for (const entry of validated) {
    setSetting(db, entry.key, entry.value, session.user.email, locationId);
  }

  revalidatePath(`/${nivel}`, "layout");
  return { error: null, message: creada ? "Sede creada." : "Sede guardada." };
}

export async function alternarSede(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "settings.write");
  if (!session) return fail("No tenés permiso para administrar las sedes.");

  const id = String(formData.get("id") ?? "");
  const activar = formData.get("activar") === "1";

  try {
    setLocationActive(session.resolved.context.db, id, activar);
  } catch (error) {
    if (error instanceof LocationError) {
      return fail(LOCATION_ERRORS[error.code] ?? "No se pudo cambiar el estado de la sede.");
    }
    throw error;
  }

  revalidatePath(`/${nivel}`, "layout");
  return { error: null, message: activar ? "Sede activada." : "Sede desactivada." };
}
