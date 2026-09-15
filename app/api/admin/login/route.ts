import { NextResponse } from "next/server";
import { authenticateUser, setAdminSession } from "@/lib/auth";
import { ensureV13Schema } from "@/lib/migrations";

export async function POST(request: Request) {
  await ensureV13Schema();
  const body = await request.json().catch(() => ({}));
  const user = await authenticateUser(String(body.email || ""), String(body.password || ""));
  if (!user) return NextResponse.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  await setAdminSession(user.email,user.role,user.userId);
  return NextResponse.json({ ok:true, role:user.role, permissions:user.permissions });
}
