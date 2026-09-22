/**
 * Autenticación y permisos dentro de un nivel.
 *
 * Los usuarios viven en el archivo de su nivel: un administrador de Primaria no existe siquiera
 * como fila en la base de Secundaria. Eso es lo que hace que «un administrador por nivel» sea una
 * propiedad de la estructura y no una condición que haya que recordar verificar.
 *
 * Los permisos se resuelven en cada verificación y no se guardan en la sesión: así, quitarle un
 * permiso a alguien tiene efecto inmediato, sin esperar a que cierre sesión.
 */

import type { DatabaseSync } from "node:sqlite";
import { verifySecret, hashSecret } from "@/core/platform/secrets";

type Db = DatabaseSync;

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  mustChangePassword: boolean;
  permissions: string[];
  roles: string[];
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  active: number;
  must_change_password: number;
};

export function permissionsOf(db: Db, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT rp.permission_code AS code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE ur.user_id = ?
       ORDER BY code`
    )
    .all(userId) as unknown as { code: string }[];
  return rows.map((row) => row.code);
}

export function rolesOf(db: Db, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? ORDER BY r.code`
    )
    .all(userId) as unknown as { code: string }[];
  return rows.map((row) => row.code);
}

export function loadUser(db: Db, userId: string): AuthenticatedUser | null {
  const row = db
    .prepare(`SELECT id, email, password_hash, name, active, must_change_password FROM users WHERE id = ?`)
    .get(userId) as unknown as UserRow | undefined;
  if (!row || row.active !== 1) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    mustChangePassword: row.must_change_password === 1,
    permissions: permissionsOf(db, row.id),
    roles: rolesOf(db, row.id),
  };
}

/**
 * Verifica las credenciales.
 *
 * Cuando el correo no existe igual se hace una verificación contra un hash descartable: sin eso,
 * la diferencia de tiempo entre «usuario inexistente» y «contraseña incorrecta» permitiría
 * averiguar qué cuentas existen.
 */
export async function authenticate(
  db: Db,
  email: string,
  password: string
): Promise<AuthenticatedUser | null> {
  const normalized = email.trim().toLowerCase();
  const row = db
    .prepare(`SELECT id, email, password_hash, name, active, must_change_password FROM users WHERE lower(email) = ?`)
    .get(normalized) as unknown as UserRow | undefined;

  if (!row || row.active !== 1) {
    await verifySecret(password, await hashSecret("cuenta-inexistente"));
    return null;
  }
  if (!(await verifySecret(password, row.password_hash))) return null;

  db.prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    new Date().toISOString(),
    row.id
  );

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    mustChangePassword: row.must_change_password === 1,
    permissions: permissionsOf(db, row.id),
    roles: rolesOf(db, row.id),
  };
}

export function can(user: AuthenticatedUser | null, permission: string): boolean {
  return Boolean(user?.permissions.includes(permission));
}

export async function setPassword(
  db: Db,
  userId: string,
  password: string,
  options: { mustChange?: boolean } = {}
): Promise<void> {
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?`).run(
    await hashSecret(password),
    options.mustChange ? 1 : 0,
    new Date().toISOString(),
    userId
  );
}
