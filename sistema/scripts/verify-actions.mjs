/**
 * Un archivo `"use server"` sólo puede exportar funciones asíncronas.
 *
 * Next lo verifica al compilar la ruta, es decir cuando alguien abre la pantalla: un `export const`
 * de más no rompe `tsc` ni ninguna de las suites de dominio, y aparece recién en el navegador. Este
 * chequeo lo adelanta al momento de escribir el código.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../app", import.meta.url).pathname;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const OFFENDERS = /^export\s+(?:const|let|var|class|default\s+(?!async))/;
const FUNCTION = /^export\s+async\s+function\s/;
const TYPE = /^export\s+(?:type|interface)\s/;

let bad = 0;
let checked = 0;

for (const file of files(ROOT)) {
  const source = readFileSync(file, "utf8");
  if (!/^\s*["']use server["']/.test(source)) continue;
  checked++;
  source.split("\n").forEach((line, index) => {
    if (TYPE.test(line) || FUNCTION.test(line)) return;
    if (!/^export\s/.test(line)) return;
    if (OFFENDERS.test(line) || !FUNCTION.test(line)) {
      bad++;
      console.error(
        `✗ ${file.replace(ROOT, "app")}:${index + 1}  ${line.trim()}\n` +
          `  Un archivo "use server" sólo exporta funciones async. Mové esto a un módulo hermano.`
      );
    }
  });
}

if (bad) {
  console.error(`\n${bad} exportación(es) inválida(s) en archivos "use server".`);
  process.exit(1);
}
console.log(`✓ ${checked} archivos "use server" exportan sólo funciones asíncronas.`);
