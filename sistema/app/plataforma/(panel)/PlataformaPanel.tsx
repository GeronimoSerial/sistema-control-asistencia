"use client";

import { useActionState, useState } from "react";
import {
  crearNivel,
  cambiarEstadoNivel,
  crearOperador,
  alternarOperador,
  cambiarClaveOperador,
} from "./actions";
import { emptyState, ESTADOS, type ActionState } from "./shared";

export type LevelRow = {
  slug: string;
  name: string;
  status: string;
  databaseFile: string;
  timeZone: string;
  rulePack: string | null;
  createdAt: string;
  people: number | null;
  users: number | null;
  size: number | null;
};

export type OperatorRow = {
  id: string;
  email: string;
  name: string | null;
  active: number;
  lastLoginAt: string | null;
};

function tamaño(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Aviso({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && <div className="notice bad" style={{ marginBottom: 14 }}>{state.error}</div>}
      {state.message && <div className="notice ok" style={{ marginBottom: 14 }}>{state.message}</div>}
    </>
  );
}

export default function PlataformaPanel({
  levels,
  operadores,
  carpeta,
  paquete,
}: {
  levels: LevelRow[];
  operadores: OperatorRow[];
  carpeta: string;
  paquete: { id: string; zona: string };
}) {
  const [nivelState, crear, creando] = useActionState(crearNivel, emptyState);
  const [estadoState, cambiarEstado] = useActionState(cambiarEstadoNivel, emptyState);
  const [opState, nuevoOperador] = useActionState(crearOperador, emptyState);
  const [altState, alternar] = useActionState(alternarOperador, emptyState);
  const [claveState, cambiarClave] = useActionState(cambiarClaveOperador, emptyState);

  const [abierto, setAbierto] = useState(levels.length === 0);
  const [operadoresAbierto, setOperadoresAbierto] = useState(false);

  return (
    <>
      <Aviso state={nivelState} />
      <Aviso state={estadoState} />
      <Aviso state={opState} />
      <Aviso state={altState} />
      <Aviso state={claveState} />

      {!abierto && (
        <button
          onClick={() => setAbierto(true)}
          style={{ width: "auto", padding: "10px 18px", fontSize: 15, marginBottom: 18 }}
        >
          Crear un nivel
        </button>
      )}

      {abierto && (
        <form action={crear} className="card" style={{ marginBottom: 22 }}>
          <h2>Nuevo nivel</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Se crea un archivo propio en <code>{carpeta}</code> con el esquema completo y el paquete
            de reglas <code>{paquete.id}</code>. Los datos de un nivel no se mezclan con los de otro
            porque están en archivos distintos.
          </p>

          <div className="form-grid">
            <div>
              <label htmlFor="nombre">Nombre</label>
              <input id="nombre" name="nombre" required placeholder="Nivel Primario" />
            </div>
            <div>
              <label htmlFor="slug">Identificador en la dirección</label>
              <input id="slug" name="slug" placeholder="primaria" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="zona">Zona horaria</label>
              <input id="zona" name="zona" defaultValue={paquete.zona} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Si dejás el identificador vacío se arma con el nombre. Es lo que va en la dirección:{" "}
            <code>/primaria</code>, <code>/primaria/admin</code>.
          </p>

          <h2 style={{ marginTop: 18 }}>Sede</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Opcional. Sin coordenadas el nivel funciona igual, pero no hay geocerca: cualquiera
            podría marcar desde cualquier lado. Se puede cargar después desde la configuración del
            nivel.
          </p>
          <div className="form-grid">
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="sedeNombre">Nombre de la sede</label>
              <input id="sedeNombre" name="sedeNombre" placeholder="Sede central" />
            </div>
            <div>
              <label htmlFor="lat">Latitud</label>
              <input id="lat" name="lat" inputMode="decimal" placeholder="-27.4692" />
            </div>
            <div>
              <label htmlFor="lng">Longitud</label>
              <input id="lng" name="lng" inputMode="decimal" placeholder="-58.8306" />
            </div>
          </div>

          <h2 style={{ marginTop: 18 }}>Primer administrador</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Opcional, pero sin esto nadie puede entrar al panel del nivel. Se le pide cambiar la
            contraseña en el primer ingreso.
          </p>
          <div className="form-grid">
            <div>
              <label htmlFor="adminEmail">Correo</label>
              <input id="adminEmail" name="adminEmail" type="email" placeholder="ana@ejemplo.gob.ar" />
            </div>
            <div>
              <label htmlFor="adminClave">Contraseña inicial</label>
              <input id="adminClave" name="adminClave" type="text" placeholder="al menos 10 caracteres" />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="submit" disabled={creando} style={{ width: "auto", padding: "12px 22px" }}>
              {creando ? "Creando…" : "Crear nivel"}
            </button>
            {levels.length > 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setAbierto(false)}
                style={{ width: "auto", padding: "12px 22px" }}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      <h2>Niveles</h2>
      <div className="table-wrap" style={{ marginBottom: 22 }}>
        {levels.length === 0 ? (
          <p className="empty">Todavía no hay ningún nivel. Creá el primero acá arriba.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nivel</th>
                <th>Dirección</th>
                <th>Estado</th>
                <th className="num">Agentes</th>
                <th className="num">Usuarios</th>
                <th className="num">Archivo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr key={level.slug}>
                  <td>
                    <strong>{level.name}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {level.timeZone} · desde {level.createdAt}
                    </div>
                  </td>
                  <td>
                    <code>/{level.slug}</code>
                    <div className="muted" style={{ fontSize: 13 }}>{level.databaseFile}</div>
                  </td>
                  <td>
                    {level.status === "ACTIVE" ? <span className="tag ok">{ESTADOS.ACTIVE}</span>
                      : level.status === "SUSPENDED" ? <span className="tag warn">{ESTADOS.SUSPENDED}</span>
                      : <span className="tag plain">{ESTADOS.ARCHIVED}</span>}
                  </td>
                  <td className="num">{level.people ?? "—"}</td>
                  <td className="num">{level.users ?? "—"}</td>
                  <td className="num">
                    {level.size === null
                      ? <span className="tag bad">No se encuentra</span>
                      : tamaño(level.size)}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {level.status === "ACTIVE" ? (
                      <form action={cambiarEstado} style={{ display: "inline" }}>
                        <input type="hidden" name="slug" value={level.slug} />
                        <input type="hidden" name="estado" value="SUSPENDED" />
                        <button className="secondary" style={{ width: "auto", padding: "6px 12px", fontSize: 14 }}>
                          Suspender
                        </button>
                      </form>
                    ) : (
                      <form action={cambiarEstado} style={{ display: "inline" }}>
                        <input type="hidden" name="slug" value={level.slug} />
                        <input type="hidden" name="estado" value="ACTIVE" />
                        <button className="secondary" style={{ width: "auto", padding: "6px 12px", fontSize: 14 }}>
                          Activar
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: -12, marginBottom: 22 }}>
        Suspender un nivel no borra nada: su archivo queda donde está y sus pantallas dejan de
        responder. Se revierte activándolo de nuevo. Para dar de baja un nivel de verdad, guardá su
        archivo y borralo del servidor.
      </p>

      <button
        onClick={() => setOperadoresAbierto(!operadoresAbierto)}
        className="secondary"
        style={{ width: "auto", padding: "10px 18px", fontSize: 15, marginBottom: 18 }}
      >
        {operadoresAbierto ? "Ocultar operadores" : "Operadores de plataforma"}
      </button>

      {operadoresAbierto && (
        <>
          <h2>Operadores</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Son las únicas cuentas que pueden crear o suspender niveles. No tienen acceso al panel
            de ningún nivel: eso depende de los usuarios de cada uno.
          </p>
          <div className="table-wrap" style={{ marginBottom: 18 }}>
            <table>
              <thead>
                <tr>
                  <th>Correo</th>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Último ingreso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {operadores.map((operador) => (
                  <tr key={operador.id}>
                    <td>{operador.email}</td>
                    <td>{operador.name ?? "—"}</td>
                    <td>
                      {operador.active === 1
                        ? <span className="tag ok">Activo</span>
                        : <span className="tag plain">Deshabilitado</span>}
                    </td>
                    <td>{operador.lastLoginAt ?? "—"}</td>
                    <td>
                      <form action={alternar} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={operador.id} />
                        <input type="hidden" name="activar" value={operador.active === 1 ? "0" : "1"} />
                        <button className="secondary" style={{ width: "auto", padding: "6px 12px", fontSize: 14 }}>
                          {operador.active === 1 ? "Deshabilitar" : "Habilitar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={nuevoOperador} className="card" style={{ marginBottom: 18 }}>
            <h2>Nuevo operador</h2>
            <div className="form-grid">
              <div>
                <label htmlFor="opEmail">Correo</label>
                <input id="opEmail" name="email" type="email" required />
              </div>
              <div>
                <label htmlFor="opNombre">Nombre</label>
                <input id="opNombre" name="nombre" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="opClave">Contraseña</label>
                <input id="opClave" name="clave" type="text" required placeholder="al menos 10 caracteres" />
              </div>
            </div>
            <button type="submit" style={{ width: "auto", padding: "10px 18px", fontSize: 15 }}>
              Crear operador
            </button>
          </form>

          <form action={cambiarClave} className="card">
            <h2>Cambiar mi contraseña</h2>
            <div>
              <label htmlFor="miClave">Contraseña nueva</label>
              <input id="miClave" name="clave" type="password" required autoComplete="new-password" />
            </div>
            <button type="submit" style={{ width: "auto", padding: "10px 18px", fontSize: 15, marginTop: 12 }}>
              Cambiar
            </button>
          </form>
        </>
      )}
    </>
  );
}
