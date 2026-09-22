/**
 * Resolución de configuración por organización.
 *
 * Un valor se busca primero en el ámbito más específico (una sede concreta), luego en la
 * organización, y si no existe se usa el valor por defecto de la definición. Nada de esto
 * requiere columnas nuevas: agregar un parámetro es agregar un `defineSetting`.
 */

import { sql } from "@/core/platform/db";
import {
  allDefinitions,
  getDefinition,
  validateSetting,
  type SettingDefinition,
} from "@/core/config/definitions";

export type SettingScopeRef = {
  organizationId: string;
  /** `null` = ámbito de organización. */
  locationId?: string | null;
};

export type ResolvedSettings = {
  get<T = unknown>(key: string): T;
  getString(key: string): string;
  getNumber(key: string): number;
  getBoolean(key: string): boolean;
  /** Valores explícitos, sin los defaults. Útil para mostrar qué fue modificado. */
  overrides: Record<string, unknown>;
};

type SettingRow = { key: string; value: unknown; scope_type: string; scope_id: string | null };

function defaultsMap(): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const definition of allDefinitions()) map[definition.key] = definition.default;
  return map;
}

export async function loadSettings(scope: SettingScopeRef): Promise<ResolvedSettings> {
  const rows = (await sql()`
    SELECT key, value, scope_type, scope_id
    FROM setting_values
    WHERE organization_id = ${scope.organizationId}
      AND (
        scope_type = 'ORGANIZATION'
        OR (scope_type = 'LOCATION' AND scope_id = ${scope.locationId ?? null})
      )
  `) as unknown as SettingRow[];

  const values = defaultsMap();
  const overrides: Record<string, unknown> = {};

  // Primero organización, después sede: lo más específico pisa a lo general.
  for (const row of rows.filter((r) => r.scope_type === "ORGANIZATION")) {
    values[row.key] = row.value;
    overrides[row.key] = row.value;
  }
  for (const row of rows.filter((r) => r.scope_type === "LOCATION")) {
    values[row.key] = row.value;
    overrides[row.key] = row.value;
  }

  return buildResolved(values, overrides);
}

/** Variante sin base de datos: sólo los valores por defecto. Para arranque y pruebas. */
export function defaultSettings(): ResolvedSettings {
  return buildResolved(defaultsMap(), {});
}

function buildResolved(
  values: Record<string, unknown>,
  overrides: Record<string, unknown>
): ResolvedSettings {
  return {
    get<T>(key: string): T {
      return values[key] as T;
    },
    getString(key: string): string {
      return String(values[key] ?? "");
    },
    getNumber(key: string): number {
      return Number(values[key] ?? 0);
    },
    getBoolean(key: string): boolean {
      return Boolean(values[key]);
    },
    overrides,
  };
}

export type SettingWriteResult =
  | { ok: true }
  | { ok: false; errors: { key: string; error: string }[] };

/**
 * Guarda un conjunto de valores. Valida todo antes de escribir nada: una entrada inválida
 * cancela el lote completo, para no dejar la configuración a medias.
 */
export async function writeSettings(
  scope: SettingScopeRef,
  patch: Record<string, unknown>,
  actor: string
): Promise<SettingWriteResult> {
  const errors: { key: string; error: string }[] = [];
  const validated: { definition: SettingDefinition; value: unknown }[] = [];

  for (const [key, raw] of Object.entries(patch)) {
    const definition = getDefinition(key);
    if (!definition) {
      errors.push({ key, error: `Parámetro desconocido: ${key}` });
      continue;
    }
    const scopeMatches =
      definition.scope === "LOCATION"
        ? Boolean(scope.locationId)
        : !scope.locationId;
    if (!scopeMatches) {
      errors.push({ key, error: `${definition.label}: ámbito incorrecto` });
      continue;
    }
    const result = validateSetting(key, raw);
    if (!result.ok) errors.push({ key, error: result.error });
    else validated.push({ definition, value: result.value });
  }

  if (errors.length) return { ok: false, errors };

  const scopeType = scope.locationId ? "LOCATION" : "ORGANIZATION";
  for (const entry of validated) {
    await sql()`
      INSERT INTO setting_values (organization_id, scope_type, scope_id, key, value, updated_by)
      VALUES (
        ${scope.organizationId}, ${scopeType}, ${scope.locationId ?? ""},
        ${entry.definition.key}, ${JSON.stringify(entry.value)}::jsonb, ${actor}
      )
      ON CONFLICT (organization_id, scope_type, scope_id, key)
      DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
  }
  return { ok: true };
}
