"use client";

import { useActionState } from "react";
import {
  guardarConfiguracion,
  guardarPolitica,
  guardarSede,
  emptyState,
  type ActionState,
} from "./actions";

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

export type Policy = {
  lateness_tolerance_minutes: number;
  lateness_mode: string;
  count_early_exit: number;
  compensation_mode: string;
  auto_close_mode: string;
  auto_close_grace_minutes: number;
  movement_sequence: string;
  counting_start_date: string | null;
};

export type Location = { id: string; name: string; latitude: number | null; longitude: number | null };

function Aviso({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && <div className="notice bad" style={{ marginBottom: 14 }}>{state.error}</div>}
      {state.message && <div className="notice ok" style={{ marginBottom: 14 }}>{state.message}</div>}
    </>
  );
}

/** Dibuja el control que corresponde al tipo declarado en la definición. */
function Campo({ definition, value }: { definition: Definition; value: unknown }) {
  const common = { id: definition.key, name: definition.key };

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
      <label htmlFor={definition.key}>{definition.label}</label>
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

export default function ConfigPanel({
  nivel,
  groups,
  values,
  policy,
  location,
  puedeReglas,
}: {
  nivel: string;
  groups: Record<string, Definition[]>;
  values: Record<string, unknown>;
  policy: Policy | null;
  location: Location | null;
  puedeReglas: boolean;
}) {
  const [configState, guardar, guardando] = useActionState(guardarConfiguracion, emptyState);
  const [policyState, guardarPol, guardandoPol] = useActionState(guardarPolitica, emptyState);
  const [sedeState, guardarSed, guardandoSede] = useActionState(guardarSede, emptyState);

  return (
    <>
      <Aviso state={configState} />
      <Aviso state={policyState} />
      <Aviso state={sedeState} />

      <form action={guardar} style={{ marginBottom: 26 }}>
        <input type="hidden" name="nivel" value={nivel} />
        <input type="hidden" name="locationId" value={location?.id ?? ""} />

        {Object.entries(groups).map(([group, definitions]) => (
          <div key={group} className="card" style={{ marginBottom: 14 }}>
            <h2>{group}</h2>
            <div className="form-grid">
              {definitions.map((definition) => (
                <div
                  key={definition.key}
                  style={definition.type === "boolean" ? { gridColumn: "1 / -1" } : undefined}
                >
                  <Campo definition={definition} value={values[definition.key]} />
                </div>
              ))}
            </div>
          </div>
        ))}

        <p className="muted" style={{ fontSize: 13 }}>
          Este formulario se genera desde el registro de parámetros del sistema: cada campo, su
          tipo y su validación están declarados en un solo lugar. Agregar un parámetro nuevo no
          requiere tocar esta pantalla.
        </p>

        <button type="submit" disabled={guardando} style={{ width: "auto", padding: "12px 22px" }}>
          {guardando ? "Guardando…" : "Guardar configuración"}
        </button>
      </form>

      <form action={guardarSed} className="card" style={{ marginBottom: 26 }}>
        <h2>Sede</h2>
        <input type="hidden" name="nivel" value={nivel} />
        <div className="form-grid">
          <div>
            <label htmlFor="nombre">Nombre</label>
            <input id="nombre" name="nombre" required defaultValue={location?.name ?? "Sede central"} />
          </div>
          <div>
            <label htmlFor="lat">Latitud</label>
            <input id="lat" name="lat" required defaultValue={location?.latitude ?? ""} />
          </div>
          <div>
            <label htmlFor="lng">Longitud</label>
            <input id="lng" name="lng" required defaultValue={location?.longitude ?? ""} />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Es el centro de la geocerca. El radio se configura más arriba, en Marcación.
        </p>
        <button type="submit" disabled={guardandoSede} style={{ width: "auto", padding: "12px 22px" }}>
          {guardandoSede ? "Guardando…" : "Guardar sede"}
        </button>
      </form>

      {puedeReglas && policy && (
        <form action={guardarPol} className="card">
          <h2>Política de asistencia</h2>
          <input type="hidden" name="nivel" value={nivel} />
          <div className="form-grid">
            <div>
              <label htmlFor="tolerancia">Tolerancia de ingreso (minutos)</label>
              <input id="tolerancia" name="tolerancia" type="number" min={0} max={240}
                defaultValue={policy.lateness_tolerance_minutes} />
            </div>
            <div>
              <label htmlFor="modo">Al superar la tolerancia</label>
              <select id="modo" name="modo" defaultValue={policy.lateness_mode}>
                <option value="GRACE_ONLY">Computar sólo el exceso</option>
                <option value="FULL_FROM_SCHEDULED">Computar todo desde la hora prevista</option>
              </select>
            </div>
            <div>
              <label htmlFor="compensacion">Compensación</label>
              <select id="compensacion" name="compensacion" defaultValue={policy.compensation_mode}>
                <option value="NONE">El atraso no se compensa</option>
                <option value="SAME_DAY">La permanencia posterior compensa el mismo día</option>
              </select>
            </div>
            <div>
              <label htmlFor="cierre">Cierre automático</label>
              <select id="cierre" name="cierre" defaultValue={policy.auto_close_mode}>
                <option value="NONE">No cerrar jornadas abiertas</option>
                <option value="THEORETICAL_END">Imputar el horario de salida previsto</option>
              </select>
            </div>
            <div>
              <label htmlFor="gracia">Gracia del cierre automático (minutos)</label>
              <input id="gracia" name="gracia" type="number" min={0} max={720}
                defaultValue={policy.auto_close_grace_minutes} />
            </div>
            <div>
              <label htmlFor="secuencia">Movimientos por jornada</label>
              <select id="secuencia" name="secuencia" defaultValue={policy.movement_sequence}>
                <option value="SIMPLE">Entrada y salida únicas</option>
                <option value="MULTI">Admitir salidas intermedias y reingresos</option>
              </select>
            </div>
            <div>
              <label htmlFor="computoDesde">Inicio del cómputo de inasistencias</label>
              <input id="computoDesde" name="computoDesde" type="date"
                defaultValue={policy.counting_start_date ?? ""} />
            </div>
          </div>
          <label className="form-check" style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <input type="checkbox" name="salidaAnticipada" defaultChecked={policy.count_early_exit === 1}
              style={{ width: "auto" }} />
            <span>Computar la salida anticipada como tiempo adeudado</span>
          </label>
          <p className="muted" style={{ fontSize: 13 }}>
            Estas reglas eran código en el sistema anterior. Cambiarlas acá afecta el cálculo de
            aquí en más; los registros ya cerrados no se recalculan solos.
          </p>
          <button type="submit" disabled={guardandoPol} style={{ width: "auto", padding: "12px 22px" }}>
            {guardandoPol ? "Guardando…" : "Guardar política"}
          </button>
        </form>
      )}
    </>
  );
}
