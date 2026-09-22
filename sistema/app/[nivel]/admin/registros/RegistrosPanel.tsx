"use client";

import { useActionState, useState } from "react";
import {
  marcarManual,
  clasificarIntervalo,
  MANUAL_REASONS,
  INTERVAL_REASONS,
  emptyState,
  type ActionState,
} from "./actions";

export type Option = { id: string; label: string };

export type MovementRow = {
  id: number;
  person: string;
  person_id: string;
  event_type: string;
  local_time: string;
  source: string | null;
  note: string | null;
};

export type IntervalRow = {
  id: number;
  person: string;
  exit_time: string;
  reentry_time: string | null;
  minutes: number | null;
  reason_code: string | null;
  counts_as_work: number | null;
  classified_by: string | null;
};

const MOVEMENT_LABELS: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  REENTRY: "Reingreso",
  AUTO_EXIT: "Salida automática",
};

function Aviso({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && <div className="notice bad" style={{ marginBottom: 14 }}>{state.error}</div>}
      {state.message && <div className="notice ok" style={{ marginBottom: 14 }}>{state.message}</div>}
    </>
  );
}

export default function RegistrosPanel({
  nivel,
  fecha,
  people,
  movements,
  intervals,
  puedeMarcar,
  puedeClasificar,
}: {
  nivel: string;
  fecha: string;
  people: Option[];
  movements: MovementRow[];
  intervals: IntervalRow[];
  puedeMarcar: boolean;
  puedeClasificar: boolean;
}) {
  const [markState, marcar, marcando] = useActionState(marcarManual, emptyState);
  const [classState, clasificar] = useActionState(clasificarIntervalo, emptyState);
  const [motivo, setMotivo] = useState(MANUAL_REASONS[0].value);
  const [abierto, setAbierto] = useState(false);

  const pendientes = intervals.filter((row) => row.counts_as_work === null && row.reentry_time);

  return (
    <>
      <form className="toolbar" method="get">
        <div>
          <label htmlFor="fecha">Fecha</label>
          <input id="fecha" name="fecha" type="date" defaultValue={fecha} />
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <button type="submit">Ver</button>
        </div>
      </form>

      <Aviso state={markState} />
      <Aviso state={classState} />

      {puedeMarcar && !abierto && (
        <button
          onClick={() => setAbierto(true)}
          style={{ width: "auto", padding: "10px 18px", fontSize: 15, marginBottom: 18 }}
        >
          Marcación manual
        </button>
      )}

      {puedeMarcar && abierto && (
        <form action={marcar} className="card" style={{ marginBottom: 22 }}>
          <h2>Marcación manual excepcional</h2>
          <input type="hidden" name="nivel" value={nivel} />
          <div className="form-grid">
            <div>
              <label htmlFor="personId">Agente</label>
              <select id="personId" name="personId" required>
                <option value="">Elegir…</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>{person.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="movimiento">Movimiento</label>
              <select id="movimiento" name="movimiento" required>
                <option value="ENTRY">Entrada</option>
                <option value="EXIT">Salida</option>
                <option value="REENTRY">Reingreso</option>
              </select>
            </div>
            <div>
              <label htmlFor="fechaMarca">Fecha</label>
              <input id="fechaMarca" name="fecha" type="date" required defaultValue={fecha} />
            </div>
            <div>
              <label htmlFor="hora">Hora</label>
              <input id="hora" name="hora" type="time" required />
            </div>
            <div>
              <label htmlFor="motivo">Motivo</label>
              <select id="motivo" name="motivo" required value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {MANUAL_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>{reason.label}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="nota">Observación{motivo === "OTHER" ? "" : " (opcional)"}</label>
              <input id="nota" name="nota" required={motivo === "OTHER"} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Se aplica la misma política que a una marcación hecha desde el celular. El registro
            queda asentado como manual, con quién lo cargó y por qué.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" disabled={marcando} style={{ width: "auto", padding: "12px 22px" }}>
              {marcando ? "Registrando…" : "Registrar"}
            </button>
            <button type="button" className="secondary" onClick={() => setAbierto(false)}
              style={{ width: "auto", padding: "12px 22px" }}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {pendientes.length > 0 && puedeClasificar && (
        <>
          <h2>Salidas intermedias sin clasificar</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Falta definir el motivo y si el intervalo computa como tiempo trabajado. Sólo aparecen
            las salidas que tuvieron reingreso: una sin reingreso es simplemente el fin de la
            jornada.
          </p>
          <div className="rows" style={{ marginBottom: 22 }}>
            {pendientes.map((row) => {
              const sugerido = INTERVAL_REASONS[0];
              return (
                <form key={row.id} action={clasificar} className="card">
                  <input type="hidden" name="nivel" value={nivel} />
                  <input type="hidden" name="intervalId" value={row.id} />
                  <strong>{row.person}</strong>{" "}
                  <span className="muted">
                    salió {row.exit_time} y volvió {row.reentry_time} · {row.minutes} min
                  </span>
                  <div className="form-grid" style={{ marginTop: 10 }}>
                    <div>
                      <label htmlFor={`motivo-${row.id}`}>Motivo</label>
                      <select id={`motivo-${row.id}`} name="motivo" defaultValue={sugerido.value}>
                        {INTERVAL_REASONS.map((reason) => (
                          <option key={reason.value} value={reason.value}>{reason.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`nota-${row.id}`}>Observación</label>
                      <input id={`nota-${row.id}`} name="nota" />
                    </div>
                  </div>
                  <label style={{ display: "flex", gap: 10, alignItems: "center", margin: "10px 0" }}>
                    <input type="checkbox" name="computa" defaultChecked={sugerido.counts} style={{ width: "auto" }} />
                    <span>Computa como tiempo trabajado</span>
                  </label>
                  <button type="submit" style={{ width: "auto", padding: "10px 18px", fontSize: 15 }}>
                    Clasificar
                  </button>
                </form>
              );
            })}
          </div>
        </>
      )}

      <h2>Movimientos del día</h2>
      <div className="table-wrap" style={{ marginBottom: 22 }}>
        {movements.length === 0 ? (
          <p className="empty">No hay movimientos registrados en esta fecha.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Agente</th>
                <th>Movimiento</th>
                <th>Origen</th>
                <th>Observación</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((row) => (
                <tr key={row.id}>
                  <td>{row.local_time}</td>
                  <td>{row.person}</td>
                  <td>{MOVEMENT_LABELS[row.event_type] ?? row.event_type}</td>
                  <td>
                    {row.source === "ADMIN" ? <span className="tag warn">Manual</span>
                      : row.source === "AUTO" ? <span className="tag plain">Automático</span>
                      : <span className="tag ok">Agente</span>}
                  </td>
                  <td>{row.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {intervals.filter((row) => row.counts_as_work !== null).length > 0 && (
        <>
          <h2>Salidas ya clasificadas</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>Salió</th>
                  <th>Volvió</th>
                  <th className="num">Minutos</th>
                  <th>Motivo</th>
                  <th>Computa</th>
                  <th>Clasificó</th>
                </tr>
              </thead>
              <tbody>
                {intervals.filter((row) => row.counts_as_work !== null).map((row) => (
                  <tr key={row.id}>
                    <td>{row.person}</td>
                    <td>{row.exit_time}</td>
                    <td>{row.reentry_time ?? "—"}</td>
                    <td className="num">{row.minutes ?? "—"}</td>
                    <td>
                      {INTERVAL_REASONS.find((r) => r.value === row.reason_code)?.label ?? row.reason_code}
                    </td>
                    <td>
                      {row.counts_as_work === 1
                        ? <span className="tag ok">Sí</span>
                        : <span className="tag bad">No</span>}
                    </td>
                    <td>{row.classified_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
