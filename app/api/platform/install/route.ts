/**
 * Instalación de un organismo.
 *
 * Corre las migraciones versionadas, da de alta la organización si no existe y le aplica un rule
 * pack. Es idempotente: se puede volver a ejecutar sin duplicar nada y sin pisar la configuración
 * que el administrador haya cambiado desde la aplicación.
 *
 * No toca ninguna tabla del sistema actual: sólo crea y puebla las tablas nuevas. Mientras no se
 * complete la migración, la aplicación sigue funcionando exactamente igual.
 *
 *   curl -X POST https://<host>/api/platform/install \
 *        -H "x-setup-token: $SETUP_TOKEN" \
 *        -H "content-type: application/json" \
 *        -d '{"slug":"dge","name":"Dirección de Gestión Escolar"}'
 */

import { NextResponse } from "next/server";
import { runMigrations } from "@/core/migrations/runner";
import { migrations } from "@/core/migrations";
import {
  createOrganization,
  findOrganizationBySlug,
  normalizeSlug,
} from "@/core/tenancy/organization";
import { installPack } from "@/packs/install";
import type { RulePack } from "@/packs/types";
import rawPack from "@/packs/ar-corrientes-dge/pack.json";

const AVAILABLE_PACKS: Record<string, RulePack> = {
  "ar-corrientes-dge": rawPack as unknown as RulePack,
};

function unauthorized() {
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}

export async function POST(request: Request) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || expected.length < 24) {
    return NextResponse.json(
      { error: "SETUP_TOKEN no está configurada o es demasiado corta" },
      { status: 500 }
    );
  }
  if (request.headers.get("x-setup-token") !== expected) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    name?: string;
    pack?: string;
  };

  const packId = body.pack ?? "ar-corrientes-dge";
  const pack = AVAILABLE_PACKS[packId];
  if (!pack) {
    return NextResponse.json(
      { error: `Pack desconocido: ${packId}`, available: Object.keys(AVAILABLE_PACKS) },
      { status: 400 }
    );
  }

  try {
    const migrationReport = await runMigrations(migrations);

    const slug = normalizeSlug(body.slug ?? process.env.DEFAULT_ORGANIZATION_SLUG ?? packId);
    const existing = await findOrganizationBySlug(slug);
    const organization =
      existing ??
      (await createOrganization({
        slug,
        name: body.name ?? pack.name,
        timeZone: pack.organization.timeZone,
        locale: pack.organization.locale,
        rulePack: pack.id,
      }));

    const packReport = await installPack(organization.id, pack, "INSTALADOR");

    return NextResponse.json({
      ok: true,
      migrations: migrationReport,
      organization: { id: organization.id, slug: organization.slug, name: organization.name },
      created: !existing,
      pack: { id: pack.id, version: pack.version, ...packReport },
      // Para que la aplicación resuelva este organismo sin subdominio.
      next: `Configurar DEFAULT_ORGANIZATION_SLUG=${organization.slug} en el entorno.`,
    });
  } catch (error) {
    console.error("Fallo la instalación del organismo", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al instalar el organismo" },
      { status: 500 }
    );
  }
}
