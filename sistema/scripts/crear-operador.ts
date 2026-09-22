/**
 * Alta del primer operador de plataforma.
 *
 * Es el único paso que sigue siendo por línea de comandos, y a propósito: alguien tiene que poder
 * entrar la primera vez, y una pantalla de alta abierta mientras no haya operadores sería una
 * puerta sin llave entre el despliegue y el primer ingreso. Se corre una vez, en la instalación;
 * a partir de ahí los operadores se administran desde `/plataforma`.
 *
 *   npm run operador:crear -- --email ana@ejemplo.gob.ar --clave "una contraseña larga"
 */

import { openDatabase } from "@/core/platform/sqlite";
import { initPlatform } from "@/core/tenancy/levels";
import { createOperator, countActiveOperators, MIN_PASSWORD_LENGTH } from "@/core/tenancy/operators";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = arg("email");
const clave = arg("clave");
const nombre = arg("nombre");

if (!email || !clave) {
  console.error(
    "Faltan argumentos. Ejemplo:\n" +
      '  npm run operador:crear -- --email ana@ejemplo.gob.ar --clave "una contraseña larga"'
  );
  process.exit(1);
}
if (clave.length < MIN_PASSWORD_LENGTH) {
  console.error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  process.exit(1);
}

const dataDir = arg("data") ?? process.env.DATA_DIR ?? "./data";
const platform = openDatabase(`${dataDir}/platform.db`);
initPlatform(platform);

const operator = await createOperator(platform, { email, password: clave, name: nombre ?? null });

console.log(`Operador de plataforma: ${operator.email}`);
console.log(`  activos: ${countActiveOperators(platform)}`);
console.log("\nEntrá en http://localhost:3000/plataforma/ingresar para crear los niveles.");

platform.close();
