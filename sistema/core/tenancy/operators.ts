/**
 * Operadores de plataforma.
 *
 * Son las únicas cuentas que pueden crear, suspender o archivar niveles. Viven en `platform.db`,
 * separadas de los administradores de cada nivel, y la separación es deliberada: el administrador
 * de Primaria administra Primaria, y no tiene por qué poder crear Secundaria ni entrar en ella.
 * Si ambas cuentas vivieran en la misma tabla, un permiso mal asignado alcanzaría para cruzar esa
 * línea.
 *
 * No hay roles ni permisos acá. Un operador puede hacer las cuatro cosas que puede hacer un
 * operador; inventar un sistema de permisos para un conjunto de dos o tres personas sería
 * complejidad sin uso.
 */

import type { Db } from "@/core/platform/sqlite";
import { hashSecret, verifySecret } from "@/core/platform/secrets";

export type Operator = {
  id: string;
  email: string;
  name: string | null;
  active: number;
  lastLoginAt: string | null;
  createdAt: string;
};

type OperatorRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  active: number;
  last_login_at: string | null;
  created_at: string;
};

function toOperator(row: OperatorRow): Operator {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    active: row.active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export const MIN_PASSWORD_LENGTH = 10;

export function listOperators(db: Db): Operator[] {
  const rows = db
    .prepare(`SELECT * FROM platform_users ORDER BY active DESC, email`)
    .all() as unknown as OperatorRow[];
  return rows.map(toOperator);
}

export function countActiveOperators(db: Db): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM platform_users WHERE active = 1`)
    .get() as unknown as { n: number };
  return Number(row.n);
}

export function findOperator(db: Db, id: string): Operator | null {
  const row = db.prepare(`SELECT * FROM platform_users WHERE id = ?`).get(id) as
    unknown as OperatorRow | undefined;
  return row && row.active === 1 ? toOperator(row) : null;
}

export async function createOperator(
  db: Db,
  input: { email: string; password: string; name?: string | null }
): Promise<Operator> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("EMAIL_INVALID");
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new Error("PASSWORD_TOO_SHORT");

  const hash = await hashSecret(input.password);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO platform_users (id, email, password_hash, name, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, active = 1`
  ).run(crypto.randomUUID(), email, hash, input.name?.trim() || null, now);

  const row = db.prepare(`SELECT * FROM platform_users WHERE email = ?`).get(email) as
    unknown as OperatorRow;
  return toOperator(row);
}

/**
 * Verifica credenciales. Cuando la cuenta no existe se calcula un hash igual, para que el tiempo
 * de respuesta no revele qué correos están registrados.
 */
export async function authenticateOperator(
  db: Db,
  email: string,
  password: string
): Promise<Operator | null> {
  const row = db
    .prepare(`SELECT * FROM platform_users WHERE lower(email) = ?`)
    .get(email.trim().toLowerCase()) as unknown as OperatorRow | undefined;

  if (!row || row.active !== 1) {
    await verifySecret(password, await hashSecret("cuenta-inexistente"));
    return null;
  }
  if (!(await verifySecret(password, row.password_hash))) return null;

  const now = new Date().toISOString();
  db.prepare(`UPDATE platform_users SET last_login_at = ? WHERE id = ?`).run(now, row.id);
  return toOperator({ ...row, last_login_at: now });
}

/**
 * Da de baja o rehabilita un operador.
 *
 * Desactivar el último operador activo dejaría la plataforma sin nadie que pueda administrarla, y
 * la única salida sería volver a la línea de comandos. Se rechaza acá, en el núcleo, y no en la
 * pantalla, para que ninguna otra vía lo esquive.
 */
export function setOperatorActive(db: Db, id: string, active: boolean): void {
  if (!active && countActiveOperators(db) <= 1) {
    const row = db.prepare(`SELECT active FROM platform_users WHERE id = ?`).get(id) as
      unknown as { active: number } | undefined;
    if (row?.active === 1) throw new Error("LAST_OPERATOR");
  }
  db.prepare(`UPDATE platform_users SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
}

export async function setOperatorPassword(db: Db, id: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error("PASSWORD_TOO_SHORT");
  db.prepare(`UPDATE platform_users SET password_hash = ? WHERE id = ?`).run(
    await hashSecret(password),
    id
  );
}
