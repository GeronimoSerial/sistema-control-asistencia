import { existsSync, statSync } from "node:fs";
import { platformDb, dataDir } from "@/lib/levels";
import { listLevels } from "@/core/tenancy/levels";
import { listOperators } from "@/core/tenancy/operators";
import { openDatabase } from "@/core/platform/sqlite";
import PlataformaPanel, { type LevelRow, type OperatorRow } from "./PlataformaPanel";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

export const dynamic = "force-dynamic";

/**
 * Cuenta qué hay adentro de un nivel.
 *
 * Se abre el archivo sólo para leer: es lo que convierte una lista de nombres en algo que sirve
 * para decidir. Si el archivo no se puede abrir —porque se movió o se borró— se dice eso, en vez
 * de romper la pantalla entera por un nivel.
 */
function contarNivel(file: string): { people: number | null; users: number | null; size: number | null } {
  // Se comprueba la existencia antes de abrir: `openDatabase` crearía el archivo, y un nivel cuyo
  // archivo desapareció se vería como un nivel vacío en vez de como lo que es.
  if (!existsSync(file)) return { people: null, users: null, size: null };
  try {
    const db = openDatabase(file);
    try {
      const people = db.prepare(`SELECT COUNT(*) AS n FROM people WHERE active = 1`).get() as
        unknown as { n: number };
      const users = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE active = 1`).get() as
        unknown as { n: number };
      return { people: Number(people.n), users: Number(users.n), size: statSync(file).size };
    } finally {
      db.close();
    }
  } catch {
    return { people: null, users: null, size: null };
  }
}

export default async function PlataformaPage() {
  const platform = platformDb();
  const operators = listOperators(platform);

  const levels: LevelRow[] = listLevels(platform).map((level) => {
    const counts = contarNivel(level.databaseFile);
    return {
      slug: level.slug,
      name: level.name,
      status: level.status,
      databaseFile: level.databaseFile,
      timeZone: level.timeZone,
      rulePack: level.rulePack,
      createdAt: level.createdAt.slice(0, 10),
      ...counts,
    };
  });

  const operadores: OperatorRow[] = operators.map((operator) => ({
    id: operator.id,
    email: operator.email,
    name: operator.name,
    active: operator.active,
    lastLoginAt: operator.lastLoginAt ? operator.lastLoginAt.slice(0, 10) : null,
  }));

  return (
    <PlataformaPanel
      levels={levels}
      operadores={operadores}
      carpeta={dataDir()}
      paquete={{ id: pack.id, zona: pack.organization.timeZone }}
    />
  );
}
