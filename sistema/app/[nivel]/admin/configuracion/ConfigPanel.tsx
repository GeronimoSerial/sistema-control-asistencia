"use client";

import { useActionState } from "react";
import { guardarConfiguracion, guardarPolitica } from "./actions";
import { emptyState, type ActionState } from "./shared";
import { Campo, type Definition } from "../_ui/Campo";

export type { Definition };

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

function Aviso({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && <div className="notice bad" style={{ marginBottom: 14 }}>{state.error}</div>}
      {state.message && <div className="notice ok" style={{ marginBottom: 14 }}>{state.message}</div>}
    </>
  );
}

export default function ConfigPanel({
  nivel,
  groups,
  values,
  policy,
  puedeReglas,
}: {
  nivel: string;
  groups: Record<string, Definition[]>;
  values: Record<string, unknown>;
  policy: Policy | null;
  puedeReglas: boolean;
}) {
  const [configState, guardar, guardando] = useActionState(guardarConfiguracion, emptyState);
  const [policyState, guardarPol, guardandoPol] = useActionState(guardarPolitica, emptyState);

  return (
    <>
      <Aviso state={configState} />
      <Aviso state={policyState} />

      <form action={guardar} style={{ marginBottom: 26 }}>
        <input type="hidden" name="nivel" value={nivel} />

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
          requiere tocar esta pantalla. Los parámetros que valen por sede —geocerca, vigencia del
          QR— se configuran en <strong>Sedes</strong>, uno por cada una.
        </p>

        <button type="submit" disabled={guardando} style={{ width: "auto", padding: "12px 22px" }}>
          {guardando ? "Guardando…" : "Guardar configuración"}
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
