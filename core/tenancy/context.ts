/**
 * Contexto de organización por request.
 *
 * Todo lo que antes era una constante global —zona horaria, marca, tolerancias— se resuelve
 * aquí, una vez por request, a partir de la organización que corresponde. Los módulos del
 * núcleo reciben el contexto; no leen `process.env` ni constantes de módulo.
 */

import { cache } from "react";
import { headers } from "next/headers";
import { loadSettings, defaultSettings, type ResolvedSettings } from "@/core/config/settings";
import { SETTING_KEYS } from "@/core/config/definitions";
import {
  findOrganizationBySlug,
  findOrganizationById,
  type Organization,
} from "@/core/tenancy/organization";

export type Branding = {
  name: string;
  kicker: string;
  footer: string;
  appTitle: string;
  accentColor: string;
};

export type OrganizationContext = {
  organization: Organization;
  settings: ResolvedSettings;
  timeZone: string;
  locale: string;
  branding: Branding;
};

export function brandingFrom(settings: ResolvedSettings, fallbackName: string): Branding {
  const name = settings.getString(SETTING_KEYS.brandName) || fallbackName;
  return {
    name,
    kicker: settings.getString(SETTING_KEYS.brandKicker),
    footer: settings.getString(SETTING_KEYS.brandFooter) || name,
    appTitle: settings.getString(SETTING_KEYS.appTitle),
    accentColor: settings.getString(SETTING_KEYS.brandAccent),
  };
}

export async function contextForOrganization(
  organization: Organization
): Promise<OrganizationContext> {
  const settings = await loadSettings({ organizationId: organization.id });
  return {
    organization,
    settings,
    // La organización guarda zona y locale como columnas propias porque se necesitan antes de
    // poder leer la configuración; los settings permiten sobreescribirlas.
    timeZone: settings.getString(SETTING_KEYS.timeZone) || organization.timeZone,
    locale: settings.getString(SETTING_KEYS.locale) || organization.locale,
    branding: brandingFrom(settings, organization.name),
  };
}

/**
 * Resuelve la organización del request.
 *
 * Estrategia: subdominio (`organismo.dominio`) y, si no aplica, la variable
 * `DEFAULT_ORGANIZATION_SLUG`, que es lo que permite que el despliegue actual siga funcionando
 * en una sola URL mientras dura la migración.
 */
export const currentOrganization = cache(async (): Promise<Organization | null> => {
  const host = (await headers()).get("host") ?? "";
  const subdomain = host.split(":")[0].split(".")[0];
  const reserved = new Set(["www", "localhost", "app", "admin", ""]);

  if (!reserved.has(subdomain)) {
    const bySubdomain = await findOrganizationBySlug(subdomain);
    if (bySubdomain) return bySubdomain;
  }

  const fallbackSlug = process.env.DEFAULT_ORGANIZATION_SLUG;
  if (fallbackSlug) return findOrganizationBySlug(fallbackSlug);

  const fallbackId = process.env.DEFAULT_ORGANIZATION_ID;
  if (fallbackId) return findOrganizationById(fallbackId);

  return null;
});

/**
 * Identificador de la organización del request, o `null` si todavía no hay ninguna instalada.
 *
 * Nunca lanza: durante la transición las tablas de tenancy pueden no existir aún, y en ese caso
 * quien llama debe poder seguir con el comportamiento anterior en vez de romper la pantalla.
 */
export const currentOrganizationId = cache(async (): Promise<string | null> => {
  try {
    const organization = await currentOrganization();
    return organization?.id ?? null;
  } catch {
    return null;
  }
});

export const currentContext = cache(async (): Promise<OrganizationContext | null> => {
  const organization = await currentOrganization();
  if (!organization) return null;
  return contextForOrganization(organization);
});

/**
 * Contexto neutro para pantallas que se muestran antes de resolver el tenant (errores de
 * arranque, instalación inicial). No inventa una marca institucional.
 */
export function neutralBranding(): Branding {
  return brandingFrom(defaultSettings(), "Control de Asistencia");
}
