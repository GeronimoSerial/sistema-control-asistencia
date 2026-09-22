/**
 * Organizaciones (tenants).
 *
 * El esquema actual es single-tenant por diseño: `office_settings` tiene
 * `id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1)`, y `employees.dni` es `UNIQUE` global.
 * Aquí se introduce la entidad que después se propaga como `organization_id` a todas las tablas
 * de dominio, y sobre la que el módulo de administración da de alta organismos nuevos.
 */

import { sql } from "@/core/platform/db";

export type OrganizationStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export type Organization = {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
  timeZone: string;
  locale: string;
  rulePack: string | null;
  createdAt: string;
};

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  time_zone: string;
  locale: string;
  rule_pack: string | null;
  created_at: string;
};

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    status: String(row.status) as OrganizationStatus,
    timeZone: String(row.time_zone),
    locale: String(row.locale),
    rulePack: row.rule_pack ? String(row.rule_pack) : null,
    createdAt: String(row.created_at),
  };
}

export async function findOrganizationBySlug(slug: string): Promise<Organization | null> {
  const rows = (await sql()`
    SELECT id, slug, name, status, time_zone, locale, rule_pack, created_at
    FROM organizations
    WHERE slug = ${slug.trim().toLowerCase()}
    LIMIT 1
  `) as unknown as OrganizationRow[];
  return rows[0] ? toOrganization(rows[0]) : null;
}

export async function findOrganizationById(id: string): Promise<Organization | null> {
  const rows = (await sql()`
    SELECT id, slug, name, status, time_zone, locale, rule_pack, created_at
    FROM organizations
    WHERE id = ${id}
    LIMIT 1
  `) as unknown as OrganizationRow[];
  return rows[0] ? toOrganization(rows[0]) : null;
}

export async function listOrganizations(): Promise<Organization[]> {
  const rows = (await sql()`
    SELECT id, slug, name, status, time_zone, locale, rule_pack, created_at
    FROM organizations
    ORDER BY name
  `) as unknown as OrganizationRow[];
  return rows.map(toOrganization);
}

export type CreateOrganizationInput = {
  slug: string;
  name: string;
  timeZone: string;
  locale: string;
  rulePack?: string | null;
};

export async function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
  const slug = normalizeSlug(input.slug);
  const rows = (await sql()`
    INSERT INTO organizations (slug, name, time_zone, locale, rule_pack)
    VALUES (${slug}, ${input.name.trim()}, ${input.timeZone}, ${input.locale}, ${input.rulePack ?? null})
    RETURNING id, slug, name, status, time_zone, locale, rule_pack, created_at
  `) as unknown as OrganizationRow[];
  return toOrganization(rows[0]);
}

/** `slug` es la clave con la que se resuelve el tenant desde la URL: sólo minúsculas y guiones. */
export function normalizeSlug(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (slug.length < 2) throw new Error("El identificador del organismo es demasiado corto");
  return slug;
}
