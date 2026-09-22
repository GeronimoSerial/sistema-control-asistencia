/**
 * Sesión del panel de administración.
 *
 * La cookie lleva el nivel, el usuario y el vencimiento, firmados con HMAC. No se usa una
 * biblioteca de JWT: para lo que hace falta acá —un valor propio que el mismo servidor emite y
 * verifica— alcanza con `node:crypto`, y es una dependencia menos que mantener en el servidor.
 *
 * La cookie **no guarda los permisos**: se resuelven contra la base en cada petición, así quitarle
 * un permiso a alguien tiene efecto inmediato.
 *
 * El nombre de la cookie incluye el nivel, de modo que alguien pueda estar autenticado en
 * Primaria y en Secundaria a la vez sin que una sesión pise a la otra.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { loadUser, type AuthenticatedUser } from "@/core/identity/auth";
import { resolveLevel, type ResolvedLevel } from "@/lib/levels";

const MAX_AGE_SECONDS = 12 * 60 * 60;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 24) {
    throw new Error("AUTH_SECRET debe estar configurada y tener al menos 24 caracteres");
  }
  return value;
}

function cookieName(levelSlug: string): string {
  return `sesion_${levelSlug}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

type Payload = { levelSlug: string; userId: string; expiresAt: number };

function encode(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(token: string): Payload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  // Comparación en tiempo constante, para no filtrar información por el tiempo de respuesta.
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

export async function startSession(levelSlug: string, userId: string): Promise<void> {
  const store = await cookies();
  store.set(cookieName(levelSlug), encode({
    levelSlug,
    userId,
    expiresAt: Date.now() + MAX_AGE_SECONDS * 1000,
  }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/${levelSlug}`,
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(levelSlug: string): Promise<void> {
  const store = await cookies();
  store.delete(cookieName(levelSlug));
}

export type AdminSession = {
  user: AuthenticatedUser;
  resolved: ResolvedLevel;
};

/** Sesión vigente del nivel, o `null`. Nunca lanza. */
export async function currentSession(levelSlug: string): Promise<AdminSession | null> {
  try {
    const store = await cookies();
    const token = store.get(cookieName(levelSlug))?.value;
    if (!token) return null;

    const payload = decode(token);
    if (!payload || payload.levelSlug !== levelSlug) return null;

    const resolved = resolveLevel(levelSlug);
    if (!resolved) return null;

    const user = loadUser(resolved.context.db, payload.userId);
    return user ? { user, resolved } : null;
  } catch {
    return null;
  }
}

/** Como `currentSession`, pero además exige un permiso. */
export async function sessionWith(
  levelSlug: string,
  permission: string
): Promise<AdminSession | null> {
  const session = await currentSession(levelSlug);
  if (!session) return null;
  return session.user.permissions.includes(permission) ? session : null;
}
