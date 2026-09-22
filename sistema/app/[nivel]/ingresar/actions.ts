"use server";

import { redirect } from "next/navigation";
import { resolveLevel } from "@/lib/levels";
import { authenticate } from "@/core/identity/auth";
import { startSession } from "@/lib/session";

export type LoginState = { error: string | null };

export async function ingresar(
  _previous: LoginState,
  formData: FormData
): Promise<LoginState> {
  const nivel = String(formData.get("nivel") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const resolved = resolveLevel(nivel);
  if (!resolved) return { error: "El nivel indicado no existe." };
  if (!email || !password) return { error: "Completá el correo y la contraseña." };

  const user = await authenticate(resolved.context.db, email, password);
  // Un solo mensaje para ambos casos: decir cuál de los dos falló sirve para averiguar
  // qué cuentas existen.
  if (!user) return { error: "Correo o contraseña incorrectos." };

  await startSession(nivel, user.id);
  // `redirect` lanza una excepción de control, así que tiene que quedar fuera de cualquier
  // try/catch que la atraparía.
  redirect(`/${nivel}/admin`);
}
