/**
 * Registro de definiciones de configuración.
 *
 * `office_settings` creció una columna por versión (tolerancia, gracia de cierre, TTL del QR,
 * fecha de inicio de cómputo…), cada una con su migración, su validación a mano en la API y su
 * campo en el formulario. Ese patrón no escala a multi-organismo.
 *
 * Aquí cada parámetro se declara una vez, con su tipo, su ámbito, su valor por defecto y su
 * validación. El módulo de administración **genera el formulario a partir de este registro**:
 * agregar un parámetro nuevo es agregar un `defineSetting` y aparece solo en la UI, validado.
 */

import { isValidTimeZone } from "@/core/platform/time";

export type SettingScope = "ORGANIZATION" | "LOCATION";

export type SettingType = "string" | "integer" | "number" | "boolean" | "enum" | "timezone" | "color";

export type SettingDefinition = {
  key: string;
  type: SettingType;
  scope: SettingScope;
  default: unknown;
  label: string;
  help?: string;
  /** Agrupa los parámetros en secciones de la pantalla de configuración. */
  group: string;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: { value: string; label: string }[];
  /** Si sólo el operador de plataforma puede modificarlo. */
  platformOnly?: boolean;
};

const registry = new Map<string, SettingDefinition>();

export function defineSetting(definition: SettingDefinition): SettingDefinition {
  if (registry.has(definition.key)) {
    throw new Error(`Configuración duplicada: ${definition.key}`);
  }
  registry.set(definition.key, definition);
  return definition;
}

export function getDefinition(key: string): SettingDefinition | null {
  return registry.get(key) ?? null;
}

export function allDefinitions(): SettingDefinition[] {
  return [...registry.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.key.localeCompare(b.key)
  );
}

export function definitionsByGroup(): Record<string, SettingDefinition[]> {
  const grouped: Record<string, SettingDefinition[]> = {};
  for (const definition of allDefinitions()) {
    (grouped[definition.group] ??= []).push(definition);
  }
  return grouped;
}

export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function validateSetting(key: string, raw: unknown): ValidationResult {
  const definition = registry.get(key);
  if (!definition) return { ok: false, error: `Parámetro desconocido: ${key}` };

  switch (definition.type) {
    case "boolean":
      if (typeof raw !== "boolean") return { ok: false, error: `${definition.label}: se espera verdadero o falso` };
      return { ok: true, value: raw };

    case "integer":
    case "number": {
      const value = Number(raw);
      if (!Number.isFinite(value)) return { ok: false, error: `${definition.label}: valor numérico inválido` };
      if (definition.type === "integer" && !Number.isInteger(value)) {
        return { ok: false, error: `${definition.label}: debe ser un número entero` };
      }
      if (definition.min !== undefined && value < definition.min) {
        return { ok: false, error: `${definition.label}: mínimo ${definition.min}` };
      }
      if (definition.max !== undefined && value > definition.max) {
        return { ok: false, error: `${definition.label}: máximo ${definition.max}` };
      }
      return { ok: true, value };
    }

    case "enum": {
      const value = String(raw);
      if (!definition.options?.some((option) => option.value === value)) {
        return { ok: false, error: `${definition.label}: opción no válida` };
      }
      return { ok: true, value };
    }

    case "timezone": {
      const value = String(raw);
      if (!isValidTimeZone(value)) return { ok: false, error: `${definition.label}: zona horaria desconocida` };
      return { ok: true, value };
    }

    case "color": {
      const value = String(raw).trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
        return { ok: false, error: `${definition.label}: se espera un color en formato #RRGGBB` };
      }
      return { ok: true, value };
    }

    case "string": {
      const value = String(raw ?? "");
      if (definition.maxLength && value.length > definition.maxLength) {
        return { ok: false, error: `${definition.label}: máximo ${definition.maxLength} caracteres` };
      }
      return { ok: true, value };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Parámetros del núcleo.
 * Ninguno menciona un organismo concreto: los valores del organismo llegan del rule pack.
 * ------------------------------------------------------------------ */

export const SETTING_KEYS = {
  brandName: "branding.name",
  brandKicker: "branding.kicker",
  brandFooter: "branding.footer",
  brandAccent: "branding.accent_color",
  appTitle: "branding.app_title",

  timeZone: "locale.time_zone",
  locale: "locale.locale",

  geofenceRadius: "attendance.geofence_radius_meters",
  requireGeolocation: "attendance.require_geolocation",
  qrTtlMinutes: "attendance.qr_ttl_minutes",
  pinLength: "attendance.pin_length",
  temporaryPinDays: "attendance.temporary_pin_valid_days",

  personIdLabel: "people.national_id_label",
  sessionHours: "security.session_hours",
} as const;

defineSetting({
  key: SETTING_KEYS.brandName,
  type: "string", scope: "ORGANIZATION", default: "", maxLength: 120,
  group: "Identidad institucional",
  label: "Nombre del organismo",
  help: "Encabeza las pantallas públicas y el panel de administración.",
});

defineSetting({
  key: SETTING_KEYS.brandKicker,
  type: "string", scope: "ORGANIZATION", default: "", maxLength: 160,
  group: "Identidad institucional",
  label: "Dependencia superior",
  help: "Línea que se muestra sobre el nombre. Puede quedar vacía.",
});

defineSetting({
  key: SETTING_KEYS.brandFooter,
  type: "string", scope: "ORGANIZATION", default: "", maxLength: 200,
  group: "Identidad institucional",
  label: "Pie de página",
});

defineSetting({
  key: SETTING_KEYS.appTitle,
  type: "string", scope: "ORGANIZATION", default: "Control de Asistencia", maxLength: 80,
  group: "Identidad institucional",
  label: "Título de la aplicación",
});

defineSetting({
  key: SETTING_KEYS.brandAccent,
  type: "color", scope: "ORGANIZATION", default: "#1d4ed8",
  group: "Identidad institucional",
  label: "Color institucional",
});

defineSetting({
  key: SETTING_KEYS.timeZone,
  type: "timezone", scope: "ORGANIZATION", default: "UTC",
  group: "Regional",
  label: "Zona horaria",
  help: "Determina la fecha de la jornada, los horarios y el cierre automático.",
});

defineSetting({
  key: SETTING_KEYS.locale,
  type: "string", scope: "ORGANIZATION", default: "es", maxLength: 12,
  group: "Regional",
  label: "Formato regional",
  help: "Cómo se muestran fechas y horas. Por ejemplo es-AR, es-CL, pt-BR.",
});

defineSetting({
  key: SETTING_KEYS.geofenceRadius,
  type: "integer", scope: "LOCATION", default: 75, min: 10, max: 5000,
  group: "Marcación",
  label: "Radio de la geocerca (metros)",
});

defineSetting({
  key: SETTING_KEYS.requireGeolocation,
  type: "boolean", scope: "LOCATION", default: true,
  group: "Marcación",
  label: "Exigir geolocalización",
  help: "Desactivarlo permite marcar sin validar la ubicación del dispositivo.",
});

defineSetting({
  key: SETTING_KEYS.qrTtlMinutes,
  type: "integer", scope: "LOCATION", default: 5, min: 1, max: 120,
  group: "Marcación",
  label: "Vigencia del QR (minutos)",
});

defineSetting({
  key: SETTING_KEYS.pinLength,
  type: "integer", scope: "ORGANIZATION", default: 4, min: 4, max: 10,
  group: "Marcación",
  label: "Longitud del PIN",
});

defineSetting({
  key: SETTING_KEYS.temporaryPinDays,
  type: "integer", scope: "ORGANIZATION", default: 7, min: 1, max: 90,
  group: "Marcación",
  label: "Vigencia del PIN provisorio (días)",
});

defineSetting({
  key: SETTING_KEYS.personIdLabel,
  type: "string", scope: "ORGANIZATION", default: "Documento", maxLength: 40,
  group: "Personas",
  label: "Etiqueta del documento de identidad",
  help: "DNI, CI, RUT, CPF… según el país. El núcleo sólo guarda una cadena.",
});

defineSetting({
  key: SETTING_KEYS.sessionHours,
  type: "integer", scope: "ORGANIZATION", default: 12, min: 1, max: 24,
  group: "Seguridad",
  label: "Duración de la sesión (horas)",
});
