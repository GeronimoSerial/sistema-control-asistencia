/**
 * Acceso a base de datos.
 *
 * Se mantiene el driver actual (Neon serverless), pero detrás de este módulo para que el resto
 * del núcleo no lo importe directamente. Cambiar a `pg`, a un pool o a otro proveedor debe ser
 * un cambio local a este archivo.
 */

import { neon } from "@neondatabase/serverless";

export type SqlClient = ReturnType<typeof neon>;

let cached: SqlClient | null = null;

export function sql(): SqlClient {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  cached = neon(url);
  return cached;
}

/** Comprueba si el esquema ya fue inicializado. */
export async function isSchemaReady(): Promise<boolean> {
  try {
    // El tipo de retorno de `neon` es una unión de formas posibles según la configuración del
    // driver, así que no admite indexado directo. El cast fija la forma que usa este proyecto.
    const rows = (await sql()`
      SELECT to_regclass('public.organizations') AS present
    `) as unknown as { present: string | null }[];
    return Boolean(rows[0]?.present);
  } catch {
    return false;
  }
}
