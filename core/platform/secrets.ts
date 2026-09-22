/**
 * Hashes de contraseñas y PIN, y tokens.
 *
 * Usa `scrypt` de Node en lugar de bcryptjs. Dos razones: no agrega una dependencia que haya que
 * instalar en el servidor, y bcryptjs es una implementación en JavaScript puro, bastante más
 * lenta que la nativa. `scrypt` además resiste mejor los ataques con hardware dedicado.
 *
 * Formato almacenado: `scrypt$<N>$<r>$<p>$<salt base64>$<derivado base64>`. Guardar los
 * parámetros junto al hash permite endurecerlos más adelante sin invalidar lo ya guardado.
 */

import {
  scrypt,
  randomBytes,
  timingSafeEqual,
  createHmac,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

export async function hashSecret(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifySecret(plain: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, salt, expected] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const derived = await scryptAsync(plain, Buffer.from(salt, "base64"), KEY_LENGTH, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    const expectedBuffer = Buffer.from(expected, "base64");
    // Comparación en tiempo constante: evita filtrar información por el tiempo de respuesta.
    return (
      derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer)
    );
  } catch {
    return false;
  }
}

/**
 * Índice determinista para poder encontrar a una persona por su PIN sin recorrer toda la tabla
 * probando hashes. No reemplaza al hash: es sólo la clave de búsqueda.
 */
export function lookupKey(secret: string, namespace: string, value: string): string {
  return createHmac("sha256", secret).update(`${namespace}:${value}`).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
