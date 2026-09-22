/**
 * Alta de un nivel desde la línea de comandos.
 *
 * Es una forma de llamar a `provisionLevel`, la misma que usa la pantalla de plataforma. El
 * procedimiento —crear el archivo, aplicarle el esquema y el paquete, cargar sede y primer
 * administrador— está escrito una sola vez, en el núcleo.
 *
 * Sigue existiendo porque en la instalación inicial, o desde un script de despliegue, es más
 * cómodo que abrir el navegador. Para el uso normal está `/plataforma`.
 *
 *   npm run nivel:crear -- --slug primaria --nombre "Nivel Primario" \
 *     --sede "Sede central" --lat -27.4692 --lng -58.8306 \
 *     --admin ana@ejemplo.gob.ar --clave "una contraseña larga"
 */

import { openDatabase } from "@/core/platform/sqlite";
import { initPlatform } from "@/core/tenancy/levels";
import { provisionLevel, ProvisionError } from "@/core/tenancy/provision";
import type { RulePack } from "@/packs/types";
import pack from "@/packs/ar-corrientes-dge/pack.json" with { type: "json" };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const slug = arg("slug");
const nombre = arg("nombre");
if (!slug || !nombre) {
  console.error(
    "Faltan argumentos. Ejemplo:\n" +
      '  npm run nivel:crear -- --slug primaria --nombre "Nivel Primario"'
  );
  process.exit(1);
}

const dataDir = arg("data") ?? process.env.DATA_DIR ?? "./data";
const platform = openDatabase(`${dataDir}/platform.db`);
initPlatform(platform);

const sede = arg("sede");
const lat = arg("lat");
const lng = arg("lng");
const adminEmail = arg("admin");
const adminClave = arg("clave");

try {
  const result = await provisionLevel(platform, pack as unknown as RulePack, {
    slug,
    name: nombre,
    timeZone: arg("tz"),
    locale: arg("locale"),
    dataDir,
    location: sede
      ? {
          name: sede,
          code: arg("sede-codigo"),
          latitude: lat === undefined ? null : Number(lat),
          longitude: lng === undefined ? null : Number(lng),
        }
      : null,
    admin: adminEmail && adminClave ? { email: adminEmail, password: adminClave } : null,
    actor: "CLI",
  });

  const { level, report } = result;
  console.log(`${result.created ? "Creado" : "Actualizado"} el nivel «${level.name}» (${level.slug})`);
  console.log(`  archivo: ${level.databaseFile}`);
  console.log(
    `  reglas: ${report.absenceTypes} tipos de ausencia, ${report.quotaTiers} tramos de cuota, ` +
      `${report.scales} escalas, ${report.policies} políticas, ${report.roles} roles`
  );
  for (const warning of report.warnings) console.warn(`  aviso: ${warning}`);
  if (sede) console.log(`  sede: ${sede}${lat && lng ? ` (${lat}, ${lng})` : " (sin geocerca)"}`);
  if (result.adminCreated) console.log(`  administrador: ${adminEmail}`);
  else if (adminEmail) console.log(`  administrador: ${adminEmail} (ya existía, se le cambió la clave)`);

  console.log(`\nAbrí http://localhost:3000/${level.slug} para ver la pantalla del QR.`);
} catch (error) {
  if (error instanceof ProvisionError) {
    console.error(`No se pudo crear el nivel: ${error.code}`);
    process.exit(1);
  }
  throw error;
} finally {
  platform.close();
}
