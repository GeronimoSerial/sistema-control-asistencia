"use client";

import { useActionState, useState } from "react";
import { guardarUsuario, restablecerClave, alternarUsuario } from "./actions";
import { emptyState, type ActionState } from "./shared";

export type RoleOption = { id: string; code: string; name: string; permissions: number };

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  active: number;
  must_change_password: number;
  last_login_at: string | null;
  role_ids: string | null;
  role_names: string | null;
};

function Aviso({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && <div className="notice bad" style={{ marginBottom: 14 }}>{state.error}</div>}
      {state.message && <div className="notice ok" style={{ marginBottom: 14 }}>{state.message}</div>}
    </>
  );
}

export default function UsuariosPanel({
  nivel,
  roles,
  rows,
  currentUserId,
}: {
  nivel: string;
  roles: RoleOption[];
  rows: UserRow[];
  currentUserId: string;
}) {
  const [formState, guardar, guardando] = useActionState(guardarUsuario, emptyState);
  const [claveState, restablecer] = useActionState(restablecerClave, emptyState);
  const [estadoState, alternar] = useActionState(alternarUsuario, emptyState);
  const [editando, setEditando] = useState<UserRow | null>(null);
  const [abierto, setAbierto] = useState(false);

  const mostrar = abierto || editando !== null;
  const rolesDe = (row: UserRow | null) => (row?.role_ids ?? "").split(",").filter(Boolean);

  return (
    <>
      <Aviso state={formState} />
      <Aviso state={claveState} />
      <Aviso state={estadoState} />

      {!mostrar && (
        <button
          onClick={() => setAbierto(true)}
          style={{ width: "auto", padding: "10px 18px", fontSize: 15, marginBottom: 18 }}
        >
          Agregar usuario
        </button>
      )}

      {mostrar && (
        <form action={guardar} className="card" style={{ marginBottom: 20 }}>
          <h2>{editando ? `Editar ${editando.email}` : "Nuevo usuario"}</h2>
          <input type="hidden" name="nivel" value={nivel} />
          <div className="form-grid">
            <div>
              <label htmlFor="email">Correo</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={editando?.email ?? ""}
                readOnly={editando !== null}
              />
            </div>
            <div>
              <label htmlFor="nombre">Nombre</label>
              <input id="nombre" name="nombre" defaultValue={editando?.name ?? ""} />
            </div>
          </div>

          <label style={{ marginTop: 6 }}>Roles</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {roles.map((role) => (
              <label key={role.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="checkbox"
                  name="roles"
                  value={role.id}
                  defaultChecked={rolesDe(editando).includes(role.id)}
                  style={{ width: "auto" }}
                />
                <span>
                  {role.name}{" "}
                  <span className="muted" style={{ fontSize: 13 }}>
                    ({role.permissions} {role.permissions === 1 ? "permiso" : "permisos"})
                  </span>
                </span>
              </label>
            ))}
          </div>

          {!editando && (
            <p className="muted" style={{ fontSize: 13 }}>
              La contraseña provisoria se genera sola y se muestra una sola vez al guardar. El
              usuario va a tener que cambiarla en su primer ingreso.
            </p>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" disabled={guardando} style={{ width: "auto", padding: "12px 22px" }}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => { setEditando(null); setAbierto(false); }}
              style={{ width: "auto", padding: "12px 22px" }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Roles</th>
              <th>Último ingreso</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={row.active ? undefined : { opacity: 0.55 }}>
                <td>
                  {row.name ?? row.email}
                  <br />
                  <span className="muted" style={{ fontSize: 13 }}>{row.email}</span>
                  {row.id === currentUserId && <> <span className="tag plain">Vos</span></>}
                  {!row.active && <> <span className="tag bad">Inactivo</span></>}
                  {row.must_change_password === 1 && <> <span className="tag warn">Debe cambiar la clave</span></>}
                </td>
                <td>{row.role_names ?? "—"}</td>
                <td>{row.last_login_at ? row.last_login_at.slice(0, 16).replace("T", " ") : "Nunca"}</td>
                <td>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <button className="linkish" onClick={() => { setEditando(row); setAbierto(true); }}>
                      Editar
                    </button>
                    <form action={restablecer} style={{ display: "inline" }}>
                      <input type="hidden" name="nivel" value={nivel} />
                      <input type="hidden" name="userId" value={row.id} />
                      <button className="linkish" type="submit">Restablecer clave</button>
                    </form>
                    {row.id !== currentUserId && (
                      <form action={alternar} style={{ display: "inline" }}>
                        <input type="hidden" name="nivel" value={nivel} />
                        <input type="hidden" name="userId" value={row.id} />
                        <input type="hidden" name="activar" value={row.active ? "0" : "1"} />
                        <button className="linkish" type="submit">
                          {row.active ? "Desactivar" : "Reactivar"}
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
