"use client";

/**
 * Control generado desde una definición de parámetro.
 *
 * Lo usan la pantalla de configuración —parámetros del nivel— y la de sedes —los que tienen
 * ámbito de sede—. Está acá y no en una de las dos porque el criterio de qué control corresponde a
 * qué tipo declarado tiene que ser uno solo: si un `boolean` se dibuja distinto en cada pantalla,
 * el registro de definiciones deja de ser la única fuente de verdad.
 */

export type Definition = {
  key: string;
  type: string;
  scope: string;
  group: string;
  label: string;
  help?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: { value: string; label: string }[];
};

export function Campo({
  definition,
  value,
  /** Prefijo del atributo `name`, para poder repetir el mismo campo por sede en una página. */
  prefix = "",
}: {
  definition: Definition;
  value: unknown;
  prefix?: string;
}) {
  const id = `${prefix}${definition.key}`;
  const common = { id, name: `${prefix}${definition.key}` };

  if (definition.type === "boolean") {
    return (
      <label className="form-check" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <input type="checkbox" {...common} defaultChecked={Boolean(value)} style={{ width: "auto", marginTop: 3 }} />
        <span>
          {definition.label}
          {definition.help && <><br /><span className="muted" style={{ fontSize: 13 }}>{definition.help}</span></>}
        </span>
      </label>
    );
  }

  return (
    <div>
      <label htmlFor={id}>{definition.label}</label>
      {definition.type === "enum" && definition.options ? (
        <select {...common} defaultValue={String(value ?? "")}>
          {definition.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={definition.type === "integer" || definition.type === "number" ? "number" : "text"}
          defaultValue={String(value ?? "")}
          min={definition.min}
          max={definition.max}
          maxLength={definition.maxLength}
        />
      )}
      {definition.help && (
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{definition.help}</div>
      )}
    </div>
  );
}
