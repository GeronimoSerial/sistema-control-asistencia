"use client";

import { Fragment, useActionState, useState } from "react";
import { marcarManual, clasificarIntervalo, corregirMovimiento, anularMovimiento } from "./actions";
import {
  MANUAL_REASONS,
  INTERVAL_REASONS,
  CORRECTION_REASONS,
  emptyState,
  type ActionState,
} from "./shared";

export type Option = { id: string; label: string };

export type MovementRow = {
  id: number;
  person: string;
  person_id: string;
  event_type: string;
  local_time: string;
  /** La misma hora como `HH:MM`, para precargar el campo de corrección. */
  edit_time: string;
  source: string | null;
  note: string | null;
  voided: boolean;
  voided_by: string | null;
  void_reason: string | null;
  corrected_by: string | null;
  correction_reason: string | null;
  original_time: string | null;
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
  puedeCorregir,
}: {
  nivel: string;
  fecha: string;
  people: Option[];
  movements: MovementRow[];
  intervals: IntervalRow[];
  puedeMarcar: boolean;
  puedeClasificar: boolean;
  puedeCorregir: boolean;
}) {
  const [markState, marcar, marcando] = useActionState(marcarManual, emptyState);
  const [classState, clasificar] = useActionState(clasificarIntervalo, emptyState);
  const [fixState, corregir, corrigiendo] = useActionState(corregirMovimiento, emptyState);
  const [voidState, anular, anulando] = useActionState(anularMovimiento, emptyState);
  const [motivo, setMotivo] = useState(MANUAL_REASONS[0].value);
  const [abierto, setAbierto] = useState(false);
  // Qué fila está desplegada y para qué. Una sola a la vez: la corrección pide confirmar un dato
  // puntual, no comparar varias.
  const [editando, setEditando] = useState<{ id: number; modo: "fix" | "void" } | null>(null);

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
      <Aviso state={fixState} />
      <Aviso state={voidState} />

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
                {puedeCorregir && <th />}
              </tr>
            </thead>
            <tbody>
              {movements.map((row) => {
                const desplegada = editando?.id === row.id ? editando.modo : null;
                return (
                  <Fragment key={row.id}>
                    <tr style={row.voided ? { opacity: 0.55 } : undefined}>
                      <td style={row.voided ? { textDecoration: "line-through" } : undefined}>
                        {row.local_time}
                      </td>
                      <td>{row.person}</td>
                      <td>
                        {MOVEMENT_LABELS[row.event_type] ?? row.event_type}
                        {row.voided && <> <span className="tag bad">Anulado</span></>}
                        {!row.voided && row.corrected_by && <> <span className="tag warn">Corregido</span></>}
                      </td>
                      <td>
                        {row.source === "ADMIN" ? <span className="tag warn">Manual</span>
                          : row.source === "AUTO" ? <span className="tag plain">Automático</span>
                          : <span className="tag ok">Agente</span>}
                      </td>
                      <td>
                        {row.note ?? "—"}
                        {row.voided && row.void_reason && (
                          <div className="muted" style={{ fontSize: 13 }}>
                            Anulado por {row.voided_by}: {row.void_reason}
                          </div>
                        )}
                        {!row.voided && row.corrected_by && (
                          <div className="muted" style={{ fontSize: 13 }}>
                            Antes {row.original_time} · corrigió {row.corrected_by}
                            {row.correction_reason ? `: ${row.correction_reason}` : ""}
                          </div>
                        )}
                      </td>
                      {puedeCorregir && (
                        <td style={{ whiteSpace: "nowrap" }}>
                          {row.voided ? (
                            <span className="muted">—</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  setEditando(desplegada === "fix" ? null : { id: row.id, modo: "fix" })
                                }
                                style={{ width: "auto", padding: "6px 12px", fontSize: 14 }}
                              >
                                Corregir
                              </button>{" "}
                              <button
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  setEditando(desplegada === "void" ? null : { id: row.id, modo: "void" })
                                }
                                style={{ width: "auto", padding: "6px 12px", fontSize: 14 }}
                              >
                                Anular
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>

                    {desplegada && (
                      <tr>
                        <td colSpan={puedeCorregir ? 6 : 5}>
                          <form action={desplegada === "fix" ? corregir : anular} className="card">
                            <input type="hidden" name="nivel" value={nivel} />
                            <input type="hidden" name="eventId" value={row.id} />
                            <strong>
                              {desplegada === "fix" ? "Corregir la hora" : "Anular el movimiento"}
                            </strong>{" "}
                            <span className="muted">
                              {MOVEMENT_LABELS[row.event_type] ?? row.event_type} de {row.person},{" "}
                              {row.local_time}
                            </span>
                            <div className="form-grid" style={{ marginTop: 10 }}>
                              {desplegada === "fix" && (
                                <div>
                                  <label htmlFor={`hora-${row.id}`}>Hora correcta</label>
                                  <input
                                    id={`hora-${row.id}`}
                                    name="hora"
                                    type="time"
                                    required
                                    defaultValue={row.edit_time}
                                  />
                                </div>
                              )}
                              <div>
                                <label htmlFor={`motivo-fix-${row.id}`}>Motivo</label>
                                <select
                                  id={`motivo-fix-${row.id}`}
                                  name="motivo"
                                  defaultValue={
                                    row.event_type === "AUTO_EXIT" ? "AUTO_CLOSE_WRONG" : "WRONG_TIME"
                                  }
                                >
                                  {CORRECTION_REASONS.map((reason) => (
                                    <option key={reason.value} value={reason.value}>
                                      {reason.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label htmlFor={`nota-fix-${row.id}`}>Observación</label>
                                <input id={`nota-fix-${row.id}`} name="nota" />
                              </div>
                            </div>
                            <p className="muted" style={{ fontSize: 13 }}>
                              {desplegada === "fix"
                                ? "La jornada se recalcula sola: tardanza, compensación y cierre salen de los movimientos vigentes."
                                : "El movimiento no se borra. Queda registrado como anulado, con quién lo anuló y por qué, y deja de contar."}
                            </p>
                            <div style={{ display: "flex", gap: 10 }}>
                              <button
                                type="submit"
                                disabled={corrigiendo || anulando}
                                style={{ width: "auto", padding: "10px 18px", fontSize: 15 }}
                              >
                                {desplegada === "fix" ? "Guardar corrección" : "Anular"}
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setEditando(null)}
                                style={{ width: "auto", padding: "10px 18px", fontSize: 15 }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
