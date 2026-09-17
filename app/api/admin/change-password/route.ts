import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ensureV13Schema } from "@/lib/migrations";
import { getAdminSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  await ensureV13Schema();
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.userId === null) {
    return NextResponse.json({ error: "La contraseña de la cuenta administradora principal se modifica desde Vercel." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");
  if (password.length < 8) return NextResponse.json({ error: "La nueva contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  if (password !== confirmPassword) return NextResponse.json({ error: "Las contraseñas no coinciden." }, { status: 400 });

  const sql = db();
  const row = (await sql`SELECT id,password_hash FROM app_users WHERE id=${session.userId} AND active=TRUE LIMIT 1`)[0];
  if (!row) return NextResponse.json({ error: "Usuario inexistente o inactivo." }, { status: 404 });
  if (await bcrypt.compare(password, String(row.password_hash))) {
    return NextResponse.json({ error: "La nueva contraseña debe ser diferente de la contraseña temporal actual." }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);
  await sql`UPDATE app_users SET password_hash=${hash},must_change_password=FALSE,updated_at=now() WHERE id=${session.userId}`;
  await writeAudit({ actor: session.email, action: "CHANGE_OWN_PASSWORD", entityType: "app_user", entityId: String(session.userId), next: { mustChangePassword: false } });
  const permissions=session.permissions||[];
  const redirect=session.role === "ADMIN" ? "/admin" : permissions.includes("LICENSES") ? "/admin/novedades" : permissions.includes("ATTENDANCE") ? "/admin/registros" : "/admin";
  return NextResponse.json({ ok: true, redirect });
}
