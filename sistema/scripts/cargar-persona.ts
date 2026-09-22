/**
 * Alta de una persona con su horario y su PIN, desde la línea de comandos.
 *
 * Provisional, hasta que exista el módulo de administración. Sirve para probar el flujo de
 * marcación de punta a punta sin pantallas.
 *
 *   npm run persona:crear -- --nivel primaria --apellido Gómez --nombre Ana \
 *     --dni 20111222 --pin 4821 --horario 08:00-14:00 --dias 1-5
 */

import { openDatabase } from "@/core/platform/sqlite";
import { initPlatform, findLevelBySlug } from "@/core/tenancy/levels";
import { setPin, type LevelContext } from "@/core/attendance/service";
import { levelPolicy } from "@/lib/levels";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const slug = arg("nivel");
const apellido = arg("apellido");
const nombre = arg("nombre");
const dni = arg("dni");
const pin = arg("pin");

if (!slug || !apellido || !nombre || !dni || !pin) {
  console.error(
    "Faltan argumentos. Ejemplo:\n" +
      "  npm run persona:crear -- --nivel primaria --apellido Gómez --nombre Ana \\\n" +
      "    --dni 20111222 --pin 4821 --horario 08:00-14:00 --dias 1-5"
  );
  process.exit(1);
}

if (!/^\d{4,10}$/.test(pin)) {
  console.error("El PIN debe tener entre 4 y 10 dígitos.");
  process.exit(1);
}

const horario = arg("horario") ?? "08:00-14:00";
const [inicio, fin] = horario.split("-");
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(inicio ?? "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(fin ?? "")) {
  console.error('El horario debe tener la forma "08:00-14:00".');
  process.exit(1);
}

/** "1-5" o "1,3,5". Lunes = 1, domingo = 7. */
function parseDays(value: string): number[] {
  if (value.includes("-")) {
    const [from, to] = value.split("-").map(Number);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  return value.split(",").map(Number);
}
const dias = parseDays(arg("dias") ?? "1-5").filter((d) => d >= 1 && d <= 7);
if (!dias.length) {
  console.error("Los días deben estar entre 1 (lunes) y 7 (domingo).");
  process.exit(1);
}

const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 24) {
  console.error("Falta AUTH_SECRET. Definila en .env.local o en el entorno antes de correr esto.");
  process.exit(1);
}

const dataDir = process.env.DATA_DIR ?? "./data";
const platform = openDatabase(`${dataDir}/platform.db`);
initPlatform(platform);
const level = findLevelBySlug(platform, slug);
if (!level) {
  console.error(`No existe el nivel «${slug}». Creálo con: npm run nivel:crear`);
  process.exit(1);
}

const db = openDatabase(level.databaseFile);
const now = new Date().toISOString();

const existing = db.prepare(`SELECT id FROM people WHERE national_id = ?`).get(dni) as
  unknown as { id: string } | undefined;
const personId = existing?.id ?? crypto.randomUUID();

db.prepare(
  `INSERT INTO people (id, last_name, first_name, national_id, employment, seniority_date, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(national_id) DO UPDATE SET
     last_name = excluded.last_name, first_name = excluded.first_name,
     employment = excluded.employment, seniority_date = excluded.seniority_date,
     updated_at = excluded.updated_at`
).run(
  personId, apellido, nombre, dni, arg("situacion") ?? "TITULAR",
  arg("antiguedad") ?? null, now, now
);

db.prepare(`DELETE FROM person_schedules WHERE person_id = ?`).run(personId);
for (const weekday of dias) {
  db.prepare(
    `INSERT INTO person_schedules (person_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)`
  ).run(personId, weekday, inicio, fin);
}

const context: LevelContext = {
  db,
  timeZone: level.timeZone,
  policy: levelPolicy(db),
  secret,
};
await setPin(context, personId, pin, { source: "CLI" });

const nombresDias = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
console.log(`${existing ? "Actualizada" : "Creada"} la persona ${apellido}, ${nombre} (${dni})`);
console.log(`  nivel: ${level.name}`);
console.log(`  horario: ${inicio} a ${fin}, ${dias.map((d) => nombresDias[d]).join(", ")}`);
console.log(`  PIN: ${pin}`);

db.close();
platform.close();
