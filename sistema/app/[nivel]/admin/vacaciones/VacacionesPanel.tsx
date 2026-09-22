"use client";

import { useActionState, useState } from "react";
import { guardarDerecho } from "./actions";
import { emptyState, type ActionState } from "./shared";

export type PersonVacation = {
  id: string;
  label: string;
  seniorityDate: string | null;
  seniorityReference: number | null;
  entitlementDays: number | null;
  basisValue: number | null;
  serviceMonths: number | null;
  extraFraction: boolean;
  usedDays: number;
};

export type ScaleTier = { fromValue: number; toValue: number | null; days: number };

export default function VacacionesPanel({
  nivel,
  anio,
  rows,
  tiers,
  proration,
  fullAfterMonths,
  puedeEscribir,
}: {
  nivel: string;
  anio: number;
  rows: PersonVacation[];
  tiers: ScaleTier[];
  proration: string;
  fullAfterMonths: number | null;
  puedeEscribir: boolean;
}) {
  const [state, guardar, guardando] = useActionState(guardarDerecho, emptyState);
  const [elegido, setElegido] = useState<PersonVacation | null>(null);

  return (
    <>
      <form className="toolbar" method="get">
        <div>
          <label htmlFor="anio">Año del beneficio</label>
          <input id="anio" name="anio" type="number" min={2000} max={2100} defaultValue={anio} />
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <button type="submit">Ver</button>
        </div>
      </form>

      {state.error && <div className="notice bad" style={{ marginBottom: 14 }}>{state.error}</div>}
      {state.message && <div className="notice ok" style={{ marginBottom: 14 }}>{state.message}</div>}

      <div className="notice info card" style={{ marginBottom: 18 }}>
        <strong>Escala vigente del nivel</strong>
        <br />
        {tiers.map((tier, index) => (
          <span key={index}>
            {tier.fromValue}
            {tier.toValue === null ? " o más" : `–${tier.toValue}`} años: {tier.days} días
            {index < tiers.length - 1 ? " · " : ""}
          </span>
        ))}
        {proration === "MONTHLY_TWELFTHS" && fullAfterMonths !== null && (
          <>
            <br />
            Con menos de {fullAfterMonths} meses de servicios se calcula proporcional, a razón de
            un doceavo por mes.
          </>
        )}
      </div>

      {puedeEscribir && (
        <form action={guardar} className="card" style={{ marginBottom: 22 }}>
          <h2>Definir derecho</h2>
          <input type="hidden" name="nivel" value={nivel} />
          <input type="hidden" name="anio" value={anio} />
          <div className="form-grid">
            <div>
              <label htmlFor="personId">Agente</label>
              <select
                id="personId"
                name="personId"
                required
                value={elegido?.id ?? ""}
                onChange={(e) => setElegido(rows.find((row) => row.id === e.target.value) ?? null)}
              >
                <option value="">Elegir…</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>{row.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="antiguedad">Antigüedad computable (años)</label>
              <input
                key={`ant-${elegido?.id ?? "none"}`}
                id="antiguedad"
                name="antiguedad"
                type="number"
                min={0}
                max={60}
                required
                defaultValue={elegido?.basisValue ?? elegido?.seniorityReference ?? 0}
              />
              {elegido?.seniorityReference !== null && elegido?.seniorityReference !== undefined && (
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  Según la fecha de antigüedad registrada: {elegido.seniorityReference} años al
                  31/12/{anio}. Se puede ajustar.
                </div>
              )}
            </div>
            <div>
              <label htmlFor="meses">Meses de servicios computables</label>
              <input
                key={`mes-${elegido?.id ?? "none"}`}
                id="meses"
                name="meses"
                type="number"
                min={0}
                max={12}
                required
                defaultValue={elegido?.serviceMonths ?? 12}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="notas">Observación</label>
              <input id="notas" name="notas" placeholder="Opcional" />
            </div>
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", margin: "6px 0 12px" }}>
            <input
              key={`fra-${elegido?.id ?? "none"}`}
              type="checkbox"
              name="fraccion"
              defaultChecked={elegido?.extraFraction ?? false}
              style={{ width: "auto" }}
            />
            <span>Hay una fracción adicional que suma un doceavo</span>
          </label>
          <p className="muted" style={{ fontSize: 13 }}>
            Los períodos sin goce de haberes no generan derecho y hay que descontarlos de los meses
            computables.
          </p>
          <button type="submit" disabled={guardando} style={{ width: "auto", padding: "12px 22px" }}>
            {guardando ? "Calculando…" : "Calcular y guardar"}
          </button>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Agente</th>
              <th className="num">Antigüedad</th>
              <th className="num">Derecho</th>
              <th className="num">Tomados</th>
              <th className="num">Saldo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const saldo = row.entitlementDays === null ? null : Math.round((row.entitlementDays - row.usedDays) * 100) / 100;
              return (
                <tr key={row.id}>
                  <td>{row.label}</td>
                  <td className="num">{row.seniorityReference ?? "—"}</td>
                  <td className="num">{row.entitlementDays ?? "—"}</td>
                  <td className="num">{row.usedDays}</td>
                  <td className="num">{saldo ?? "—"}</td>
                  <td>
                    {row.entitlementDays === null ? <span className="tag plain">Sin definir</span>
                      : saldo !== null && saldo < 0 ? <span className="tag bad">Excedido en {Math.abs(saldo)}</span>
                      : saldo === 0 ? <span className="tag warn">Agotado</span>
                      : <span className="tag ok">Disponible</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
