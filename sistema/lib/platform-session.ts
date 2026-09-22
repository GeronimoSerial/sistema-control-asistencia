/**
 * Sesión del área de plataforma.
 *
 * Misma mecánica que la sesión de nivel —cookie firmada con HMAC, sin biblioteca de JWT— pero con
 * nombre y ruta propios: `sesion_plataforma` en `/plataforma`. Que sean dos cookies distintas, con
 * rutas que no se solapan, es lo que impide que una sesión de nivel sirva para entrar acá o al
 * revés, aunque alguien tenga el mismo correo en las dos tablas.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { platformDb } from "@/lib/levels";
import { findOperator, type Operator } from "@/core/tenancy/operators";

const COOKIE = "sesion_plataforma";
const PATH = "/plataforma";
const MAX_AGE_SECONDS = 8 * 60 * 60;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 24) {
    throw new Error("AUTH_SECRET debe estar configurada y tener al menos 24 caracteres");
  }
  return value;
}

// El sufijo separa esta firma de la de las sesiones de nivel: un token de una no vale en la otra
// ni siquiera si alguien lograra moverlo de cookie.
function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`plataforma:${payload}`).digest("base64url");
}

type Payload = { operatorId: string; expiresAt: number };

function decode(token: string): Payload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    return payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export async function startPlatformSession(operatorId: string): Promise<void> {
  const body = Buffer.from(
    JSON.stringify({ operatorId, expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 })
  ).toString("base64url");
  const store = await cookies();
  store.set(COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PATH,
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endPlatformSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Operador con sesión vigente, o `null`. Nunca lanza. */
export async function currentOperator(): Promise<Operator | null> {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return null;
    const payload = decode(token);
    if (!payload) return null;
    return findOperator(platformDb(), payload.operatorId);
  } catch {
    return null;
  }
}
