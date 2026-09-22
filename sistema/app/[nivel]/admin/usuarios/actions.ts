"use server";

import { revalidatePath } from "next/cache";
import { sessionWith } from "@/lib/session";
import { setPassword, countUsersWithPermission } from "@/core/identity/auth";
import { hashSecret } from "@/core/platform/secrets";
import { type ActionState } from "./shared";

function fail(error: string): ActionState {
  return { error, message: null };
}

function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => alphabet[byte % alphabet.length])
    .join("");
}

export async function guardarUsuario(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "users.manage");
  if (!session) return fail("No tenés permiso para administrar usuarios.");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const nombre = String(formData.get("nombre") ?? "").trim();
  const roleIds = formData.getAll("roles").map(String).filter(Boolean);

  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return fail("El correo no es válido.");
  if (!roleIds.length) return fail("Asignale al menos un rol.");

  const { db } = session.resolved.context;
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as
    unknown as { id: string } | undefined;

  const password = generatePassword();
  const now = new Date().toISOString();
  const userId = existing?.id ?? crypto.randomUUID();

  if (!existing) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, must_change_password, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(userId, email, await hashSecret(password), nombre || email, session.user.email, now, now);
  } else {
    db.prepare(`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`).run(nombre || email, now, userId);
  }

  // Si al cambiar los roles el usuario perdiera users.manage y fuera el último que lo tiene,
  // el nivel quedaría sin administración posible.
  const grantsManage = db
    .prepare(
      `SELECT COUNT(*) AS total FROM role_permissions
       WHERE permission_code = 'users.manage' AND role_id IN (${roleIds.map(() => "?").join(",")})`
    )
    .get(...roleIds) as unknown as { total: number };
  const hadManage = Number(
    (db.prepare(
      `SELECT COUNT(*) AS total FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE ur.user_id = ? AND rp.permission_code = 'users.manage'`
    ).get(userId) as unknown as { total: number }).total
  );
  if (existing && hadManage > 0 && Number(grantsManage.total) === 0 && countUsersWithPermission(db, "users.manage", userId) === 0) {
    return fail("No se puede quitar ese rol: es la única cuenta que puede administrar usuarios.");
  }

  db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).run(userId);
  for (const roleId of roleIds) {
    db.prepare(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`
    ).run(userId, roleId, session.user.email, now);
  }

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, created_at)
     VALUES (?, ?, 'user', ?, ?)`
  ).run(session.user.email, existing ? "UPDATE_USER" : "CREATE_USER", userId, now);

  revalidatePath(`/${nivel}/admin/usuarios`);
  return {
    error: null,
    message: existing
      ? `Actualizado: ${email}.`
      : `Creado ${email}. Contraseña provisoria: ${password} — anotala, no se puede volver a ver. Se le va a pedir que la cambie.`,
  };
}

export async function restablecerClave(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "users.manage");
  if (!session) return fail("No tenés permiso para administrar usuarios.");

  const userId = String(formData.get("userId") ?? "");
  const { db } = session.resolved.context;
  const user = db.prepare(`SELECT email FROM users WHERE id = ?`).get(userId) as
    unknown as { email: string } | undefined;
  if (!user) return fail("El usuario no existe.");

  const password = generatePassword();
  await setPassword(db, userId, password, { mustChange: true });

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, created_at)
     VALUES (?, 'RESET_PASSWORD', 'user', ?, ?)`
  ).run(session.user.email, userId, new Date().toISOString());

  revalidatePath(`/${nivel}/admin/usuarios`);
  return {
    error: null,
    message: `Contraseña provisoria de ${user.email}: ${password} — anotala, no se puede volver a ver.`,
  };
}

export async function alternarUsuario(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const nivel = String(formData.get("nivel") ?? "");
  const session = await sessionWith(nivel, "users.manage");
  if (!session) return fail("No tenés permiso para administrar usuarios.");

  const userId = String(formData.get("userId") ?? "");
  const activar = String(formData.get("activar") ?? "") === "1";

  if (!activar && userId === session.user.id) {
    return fail("No podés darte de baja a vos mismo.");
  }

  const { db } = session.resolved.context;
  if (!activar && countUsersWithPermission(db, "users.manage", userId) === 0) {
    return fail("No se puede desactivar: es la única cuenta que puede administrar usuarios.");
  }

  db.prepare(`UPDATE users SET active = ?, updated_at = ? WHERE id = ?`).run(
    activar ? 1 : 0, new Date().toISOString(), userId
  );

  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, created_at)
     VALUES (?, ?, 'user', ?, ?)`
  ).run(session.user.email, activar ? "ACTIVATE_USER" : "DEACTIVATE_USER", userId, new Date().toISOString());

  revalidatePath(`/${nivel}/admin/usuarios`);
  return { error: null, message: activar ? "Usuario reactivado." : "Usuario desactivado." };
}
