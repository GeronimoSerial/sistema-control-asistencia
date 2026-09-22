/**
 * Resolución de los imports `@/…` para ejecutar módulos del proyecto con Node directamente.
 *
 * El código usa el alias `@/` que define `tsconfig.json`, que entienden Next y TypeScript pero no
 * Node. Este enganche lo traduce a rutas reales para poder correr y probar los módulos del núcleo
 * sin levantar la aplicación ni compilar nada.
 *
 * Es una herramienta de desarrollo: no se usa en producción.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/mi-script.ts
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { fileURLToPath, pathToFileURL } from "node:url";
      import { dirname, join } from "node:path";

      const ROOT = ${JSON.stringify(process.cwd())};
      const CANDIDATES = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];

      export function resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("@/")) {
          const base = join(ROOT, specifier.slice(2));
          for (const suffix of CANDIDATES) {
            const candidate = base + suffix;
            if (existsSync(candidate)) {
              return { url: pathToFileURL(candidate).href, shortCircuit: true };
            }
          }
        }
        // Un import relativo sin extensión tampoco lo resuelve Node en ESM.
        if (specifier.startsWith(".") && !/\\.[a-z]+$/i.test(specifier)) {
          const parentPath = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : ROOT;
          const base = join(parentPath, specifier);
          for (const suffix of CANDIDATES) {
            const candidate = base + suffix;
            if (existsSync(candidate)) {
              return { url: pathToFileURL(candidate).href, shortCircuit: true };
            }
          }
        }
        return nextResolve(specifier, context);
      }
    `),
  pathToFileURL("./")
);
