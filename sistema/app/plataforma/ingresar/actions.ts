"use server";

import { redirect } from "next/navigation";
import { platformDb } from "@/lib/levels";
import { authenticateOperator } from "@/core/tenancy/operators";
import { startPlatformSession } from "@/lib/platform-session";

export async function ingresarPlataforma(
  _previous: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Completá el correo y la contraseña." };

  const operator = await authenticateOperator(platformDb(), email, password);
  // Un solo mensaje para los dos casos: distinguirlos serviría para averiguar qué cuentas existen.
  if (!operator) return { error: "Correo o contraseña incorrectos." };

  await startPlatformSession(operator.id);
  redirect("/plataforma");
}
