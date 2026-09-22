"use server";

import { revalidatePath } from "next/cache";
import { platformDb, dataDir } from "@/lib/levels";
import { currentOperator } from "@/lib/platform-session";
import { setLevelStatus, findLevelBySlug, type LevelStatus } from "@/core/tenancy/levels";
import { provisionLevel, ProvisionError } from "@/core/tenancy/provision";
import {
  createOperator,
  setOperatorActive,
  setOperatorPassword,
  MIN_PASSWORD_LENGTH,
} from "@/core/tenancy/operators";
import type { RulePack } from "@/packs/types";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };
import { type ActionState } from "./shared";

function fail(error: string): ActionState {
  return { error, message: null };
}

const PROVISION_ERRORS: Record<string, string> = {
  NAME_TOO_SHORT: "El nombre del nivel es demasiado corto.",
  SLUG_INVALID: "El identificador no es válido: usá letras, números y guiones.",
  TIMEZONE_INVALID: "La zona horaria no existe. Usá un nombre como America/Argentina/Buenos_Aires.",
  EMAIL_INVALID: "El correo del administrador no es válido.",
  PASSWORD_TOO_SHORT: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  COORDINATES_INCOMPLETE: "Cargá la latitud y la longitud, o ninguna de las dos.",
  LATITUDE_INVALID: "La latitud no es válida.",
  LONGITUDE_INVALID: "La longitud no es válida.",
  LOCATION_NAME_REQUIRED: "La sede necesita un nombre.",
  ADMIN_ROLE_MISSING: "El paquete de reglas no define el rol ADMIN.",
};

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Crea un nivel con su archivo, su paquete de reglas y, si se cargaron, su sede y su primer
 * administrador. Toda la lógica está en `provisionLevel`; acá sólo se leen y validan los campos
 * del formulario.
 */
export async function crearNivel(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const operator = await currentOperator();
  if (!operator) return fail("Tu sesión venció. Volvé a ingresar.");

  const nombre = String(formData.get("nombre") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const zona = String(formData.get("zona") ?? "").trim();

  const sedeNombre = String(formData.get("sedeNombre") ?? "").trim();
  const lat = numberOrNull(formData.get("lat"));
  const lng = numberOrNull(formData.get("lng"));
  if (Number.isNaN(lat) || Number.isNaN(lng)) return fail("Las coordenadas deben ser números.");

  const adminEmail = String(formData.get("adminEmail") ?? "").trim();
  const adminClave = String(formData.get("adminClave") ?? "");

  if (adminEmail && !adminClave) return fail("Poné una contraseña para el administrador.");
  if (adminClave && !adminEmail) return fail("Poné el correo del administrador.");

  try {
    const result = await provisionLevel(platformDb(), pack as unknown as RulePack, {
      slug: slug || nombre,
      name: nombre,
      timeZone: zona || undefined,
      dataDir: dataDir(),
      location: sedeNombre ? { name: sedeNombre, latitude: lat, longitude: lng } : null,
      admin: adminEmail ? { email: adminEmail, password: adminClave } : null,
      actor: operator.email,
    });

    revalidatePath("/plataforma");
    const partes = [
      result.created ? `Nivel «${result.level.name}» creado.` : `Nivel «${result.level.name}» actualizado.`,
      `${result.report.absenceTypes} tipos de licencia y ${result.report.quotaTiers} tramos de cuota instalados.`,
    ];
    if (result.adminCreated) {
      partes.push("El administrador deberá cambiar la contraseña en su primer ingreso.");
    }
    return { error: null, message: partes.join(" ") };
  } catch (error) {
    if (error instanceof ProvisionError) {
      return fail(PROVISION_ERRORS[error.code] ?? "No se pudo crear el nivel.");
    }
    throw error;
  }
}

/**
 * Cambia el estado de un nivel.
 *
 * Suspender no borra nada: el archivo queda donde está y el nivel deja de resolverse, así que sus
 * pantallas responden como si no existiera. Es reversible en cualquier momento.
 */
export async function cambiarEstadoNivel(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const operator = await currentOperator();
  if (!operator) return fail("Tu sesión venció. Volvé a ingresar.");

  const slug = String(formData.get("slug") ?? "");
  const estado = String(formData.get("estado") ?? "") as LevelStatus;
  if (!["ACTIVE", "SUSPENDED", "ARCHIVED"].includes(estado)) return fail("Estado inválido.");

  const level = findLevelBySlug(platformDb(), slug);
  if (!level) return fail("El nivel no existe.");

  setLevelStatus(platformDb(), slug, estado);
  revalidatePath("/plataforma");

  const dicho = { ACTIVE: "activado", SUSPENDED: "suspendido", ARCHIVED: "archivado" }[estado];
  return { error: null, message: `Nivel «${level.name}» ${dicho}.` };
}

export async function crearOperador(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const operator = await currentOperator();
  if (!operator) return fail("Tu sesión venció. Volvé a ingresar.");

  const email = String(formData.get("email") ?? "").trim();
  const clave = String(formData.get("clave") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();

  try {
    const creado = await createOperator(platformDb(), { email, password: clave, name: nombre || null });
    revalidatePath("/plataforma");
    return { error: null, message: `Operador ${creado.email} habilitado.` };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "EMAIL_INVALID") return fail("El correo no es válido.");
    if (code === "PASSWORD_TOO_SHORT") {
      return fail(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    throw error;
  }
}

export async function alternarOperador(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const operator = await currentOperator();
  if (!operator) return fail("Tu sesión venció. Volvé a ingresar.");

  const id = String(formData.get("id") ?? "");
  const activar = formData.get("activar") === "1";

  try {
    setOperatorActive(platformDb(), id, activar);
  } catch (error) {
    if (error instanceof Error && error.message === "LAST_OPERATOR") {
      return fail("Es el último operador activo: desactivarlo dejaría la plataforma sin administración.");
    }
    throw error;
  }

  revalidatePath("/plataforma");
  return { error: null, message: activar ? "Operador habilitado." : "Operador deshabilitado." };
}

export async function cambiarClaveOperador(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const operator = await currentOperator();
  if (!operator) return fail("Tu sesión venció. Volvé a ingresar.");

  const clave = String(formData.get("clave") ?? "");
  try {
    await setOperatorPassword(platformDb(), operator.id, clave);
  } catch (error) {
    if (error instanceof Error && error.message === "PASSWORD_TOO_SHORT") {
      return fail(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    throw error;
  }
  return { error: null, message: "Tu contraseña se cambió." };
}
