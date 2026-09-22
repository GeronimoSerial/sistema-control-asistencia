"use client";

import { useActionState, useState } from "react";
import { guardarSede, alternarSede } from "./actions";
import { emptyState, type ActionState } from "./shared";
import { Campo, type Definition } from "../_ui/Campo";

export type SedeRow = {
  id: string;
  code: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  active: number;
  values: Record<string, unknown>;
};

function Aviso({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && <div className="notice bad" style={{ marginBottom: 14 }}>{state.error}</div>}
      {state.message && <div className="notice ok" style={{ marginBottom: 14 }}>{state.message}</div>}
    </>
  );
}

function Formulario({
  nivel,
  sede,
  definitions,
  valores,
  accion,
  guardando,
  onCancelar,
}: {
  nivel: string;
  sede: SedeRow | null;
  definitions: Definition[];
  valores: Record<string, unknown>;
  accion: (formData: FormData) => void;
  guardando: boolean;
  onCancelar: () => void;
}) {
  return (
    <form action={accion} className="card" style={{ marginBottom: 18 }}>
      <h2>{sede ? `Sede ${sede.code}` : "Nueva sede"}</h2>
      <input type="hidden" name="nivel" value={nivel} />
      {sede && <input type="hidden" name="id" value={sede.id} />}

      <div className="form-grid">
        <div>
          <label htmlFor="nombre">Nombre</label>
          <input id="nombre" name="nombre" required defaultValue={sede?.name ?? ""} placeholder="Sede central" />
        </div>
        <div>
          <label htmlFor="codigo">Código</label>
          <input id="codigo" name="codigo" defaultValue={sede?.code ?? ""} placeholder="CENTRAL" />
        </div>
        <div>
          <label htmlFor="lat">Latitud</label>
          <input id="lat" name="lat" inputMode="decimal" defaultValue={sede?.latitude ?? ""} placeholder="-27.4692" />
        </div>
        <div>
          <label htmlFor="lng">Longitud</label>
          <input id="lng" name="lng" inputMode="decimal" defaultValue={sede?.longitude ?? ""} placeholder="-58.8306" />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Las coordenadas son el centro de la geocerca. Dejalas vacías y la sede funciona sin
        geocerca: se puede marcar desde cualquier lado. El código va en la dirección del QR de esta
        sede, y si lo dejás vacío se arma con el nombre.
      </p>

      <h2 style={{ marginTop: 16 }}>Parámetros de esta sede</h2>
      <div className="form-grid">
        {definitions.map((definition) => (
          <div
            key={definition.key}
            style={definition.type === "boolean" ? { gridColumn: "1 / -1" } : undefined}
          >
            <Campo definition={definition} value={valores[definition.key]} />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="submit" disabled={guardando} style={{ width: "auto", padding: "12px 22px" }}>
          {guardando ? "Guardando…" : sede ? "Guardar sede" : "Crear sede"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onCancelar}
          style={{ width: "auto", padding: "12px 22px" }}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function SedesPanel({
  nivel,
  sedes,
  definitions,
  valoresPorDefecto,
  puedeEditar,
}: {
  nivel: string;
  sedes: SedeRow[];
  definitions: Definition[];
  valoresPorDefecto: Record<string, unknown>;
  puedeEditar: boolean;
}) {
  const [saveState, guardar, guardando] = useActionState(guardarSede, emptyState);
  const [toggleState, alternar] = useActionState(alternarSede, emptyState);
  // `"nueva"` para el alta, el id de una sede para editarla, `null` para no mostrar formulario.
  const [editando, setEditando] = useState<string | null>(sedes.length === 0 ? "nueva" : null);

  const enEdicion = editando && editando !== "nueva"
    ? sedes.find((sede) => sede.id === editando) ?? null
    : null;

  return (
    <>
      <Aviso state={saveState} />
      <Aviso state={toggleState} />

      {puedeEditar && !editando && (
        <button
          onClick={() => setEditando("nueva")}
          style={{ width: "auto", padding: "10px 18px", fontSize: 15, marginBottom: 18 }}
        >
          Nueva sede
        </button>
      )}

      {puedeEditar && editando && (
        <Formulario
          key={editando}
          nivel={nivel}
          sede={enEdicion}
          definitions={definitions}
          valores={enEdicion ? enEdicion.values : valoresPorDefecto}
          accion={guardar}
          guardando={guardando}
          onCancelar={() => setEditando(null)}
        />
      )}

      <h2>Sedes</h2>
      <div className="table-wrap">
        {sedes.length === 0 ? (
          <p className="empty">Este nivel todavía no tiene ninguna sede.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Geocerca</th>
                <th>Estado</th>
                <th>QR</th>
                {puedeEditar && <th />}
              </tr>
            </thead>
            <tbody>
              {sedes.map((sede) => (
                <tr key={sede.id}>
                  <td><code>{sede.code}</code></td>
                  <td>{sede.name}</td>
                  <td>
                    {sede.latitude === null || sede.longitude === null ? (
                      <span className="tag warn">Sin geocerca</span>
                    ) : (
                      <span className="muted">
                        {sede.latitude.toFixed(5)}, {sede.longitude.toFixed(5)}
                      </span>
                    )}
                  </td>
                  <td>
                    {sede.active === 1
                      ? <span className="tag ok">Activa</span>
                      : <span className="tag plain">Inactiva</span>}
                  </td>
                  <td>
                    {sede.active === 1
                      ? <code>/{nivel}?sede={sede.code}</code>
                      : <span className="muted">—</span>}
                  </td>
                  {puedeEditar && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setEditando(editando === sede.id ? null : sede.id)}
                        style={{ width: "auto", padding: "6px 12px", fontSize: 14 }}
                      >
                        Editar
                      </button>{" "}
                      <form action={alternar} style={{ display: "inline" }}>
                        <input type="hidden" name="nivel" value={nivel} />
                        <input type="hidden" name="id" value={sede.id} />
                        <input type="hidden" name="activar" value={sede.active === 1 ? "0" : "1"} />
                        <button className="secondary" style={{ width: "auto", padding: "6px 12px", fontSize: 14 }}>
                          {sede.active === 1 ? "Desactivar" : "Activar"}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        Con más de una sede activa, la pantalla pública del nivel deja elegir en cuál se está
        marcando, y cada una emite su propio QR con su propia geocerca.
      </p>
    </>
  );
}
