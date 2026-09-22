"use client";

import { useActionState, useState } from "react";
import {
  guardarPersona,
  generarPin,
  cambiarEstado,
  desvincularDispositivo,
  emptyState,
  type ActionState,
} from "./actions";

export type PersonRow = {
  id: string;
  last_name: string;
  first_name: string;
  national_id: string;
  active: number;
  seniority_date: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  has_pin: number;
  pin_expires: string | null;
  device_count: number;
};

const DAY_INITIALS = ["", "L", "M", "X", "J", "V", "S", "D"];

function scheduleLabel(row: PersonRow): string {
  if (!row.days || !row.start_time) return "Sin horario";
  const days = row.days.split(",").map(Number).filter(Boolean);
  return `${days.map((d) => DAY_INITIALS[d]).join("")} · ${row.start_time.slice(0, 5)}–${row.end_time?.slice(0, 5)}`;
}

function Aviso({ state }: { state: ActionState }) {
  if (state.error) return <div className="notice bad" style={{ marginBottom: 14 }}>{state.error}</div>;
  if (state.message) return <div className="notice ok" style={{ marginBottom: 14 }}>{state.message}</div>;
  return null;
}

export default function PersonalPanel({
  nivel,
  rows,
  puedeEditar,
  puedeCredenciales,
}: {
  nivel: string;
  rows: PersonRow[];
  puedeEditar: boolean;
  puedeCredenciales: boolean;
}) {
  const [formState, guardar, guardando] = useActionState(guardarPersona, emptyState);
  const [pinState, pedirPin] = useActionState(generarPin, emptyState);
  const [estadoState, alternarEstado] = useActionState(cambiarEstado, emptyState);
  const [deviceState, desvincular] = useActionState(desvincularDispositivo, emptyState);
  const [editando, setEditando] = useState<PersonRow | null>(null);
  const [abierto, setAbierto] = useState(false);

  const mostrarFormulario = abierto || editando !== null;

  function editar(row: PersonRow) {
    setEditando(row);
    setAbierto(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cerrar() {
    setEditando(null);
    setAbierto(false);
  }

  return (
    <>
      <Aviso state={formState} />
      <Aviso state={pinState} />
      <Aviso state={estadoState} />
      <Aviso state={deviceState} />

      {puedeEditar && !mostrarFormulario && (
        <button
          onClick={() => setAbierto(true)}
          style={{ width: "auto", padding: "10px 18px", fontSize: 15, marginBottom: 18 }}
        >
          Agregar agente
        </button>
      )}

      {puedeEditar && mostrarFormulario && (
        <form action={guardar} className="card" style={{ marginBottom: 20 }}>
          <h2>{editando ? `Editar a ${editando.last_name}, ${editando.first_name}` : "Nuevo agente"}</h2>
          <input type="hidden" name="nivel" value={nivel} />
          <div className="form-grid">
            <div>
              <label htmlFor="apellido">Apellido</label>
              <input id="apellido" name="apellido" required defaultValue={editando?.last_name ?? ""} />
            </div>
            <div>
              <label htmlFor="nombre">Nombre</label>
              <input id="nombre" name="nombre" required defaultValue={editando?.first_name ?? ""} />
            </div>
            <div>
              <label htmlFor="documento">Documento</label>
              <input
                id="documento"
                name="documento"
                required
                defaultValue={editando?.national_id ?? ""}
                readOnly={editando !== null}
              />
            </div>
            <div>
              <label htmlFor="desde">Entrada</label>
              <input id="desde" name="desde" type="time" required defaultValue={editando?.start_time?.slice(0, 5) ?? "08:00"} />
            </div>
            <div>
              <label htmlFor="hasta">Salida</label>
              <input id="hasta" name="hasta" type="time" required defaultValue={editando?.end_time?.slice(0, 5) ?? "14:00"} />
            </div>
            <div>
              <label htmlFor="dias">Días</label>
              <input
                id="dias"
                name="dias"
                required
                defaultValue={editando?.days ?? "1-5"}
                placeholder="1-5"
              />
            </div>
            <div>
              <label htmlFor="antiguedad">Fecha de antigüedad</label>
              <input id="antiguedad" name="antiguedad" type="date" defaultValue={editando?.seniority_date ?? ""} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Los días van de 1 (lunes) a 7 (domingo). Se puede escribir un rango como 1-5 o una
            lista como 1,3,5. El horario reemplaza al que tuviera cargado.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" disabled={guardando} style={{ width: "auto", padding: "12px 22px" }}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" className="secondary" onClick={cerrar} style={{ width: "auto", padding: "12px 22px" }}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        {rows.length === 0 ? (
          <p className="empty">Todavía no hay nadie cargado en el padrón.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Agente</th>
                <th>Documento</th>
                <th>Horario</th>
                <th>PIN</th>
                <th>Teléfono</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={row.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    {row.last_name}, {row.first_name}
                    {!row.active && <> <span className="tag plain">Baja</span></>}
                  </td>
                  <td>{row.national_id}</td>
                  <td>{scheduleLabel(row)}</td>
                  <td>
                    {row.has_pin
                      ? row.pin_expires
                        ? <span className="tag warn">Provisorio</span>
                        : <span className="tag ok">Asignado</span>
                      : <span className="tag bad">Sin PIN</span>}
                  </td>
                  <td>
                    {row.device_count > 0
                      ? <span className="tag ok">Vinculado</span>
                      : <span className="tag plain">Ninguno</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {puedeEditar && (
                        <button className="linkish" onClick={() => editar(row)}>Editar</button>
                      )}
                      {puedeCredenciales && (
                        <form action={pedirPin} style={{ display: "inline" }}>
                          <input type="hidden" name="nivel" value={nivel} />
                          <input type="hidden" name="personId" value={row.id} />
                          <button className="linkish" type="submit">Generar PIN</button>
                        </form>
                      )}
                      {puedeCredenciales && row.device_count > 0 && (
                        <form action={desvincular} style={{ display: "inline" }}>
                          <input type="hidden" name="nivel" value={nivel} />
                          <input type="hidden" name="personId" value={row.id} />
                          <button className="linkish" type="submit">Desvincular</button>
                        </form>
                      )}
                      {puedeEditar && (
                        <form action={alternarEstado} style={{ display: "inline" }}>
                          <input type="hidden" name="nivel" value={nivel} />
                          <input type="hidden" name="personId" value={row.id} />
                          <input type="hidden" name="activar" value={row.active ? "0" : "1"} />
                          <button className="linkish" type="submit">
                            {row.active ? "Dar de baja" : "Reactivar"}
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
