"use client";

import { useActionState, useEffect, useState } from "react";
import { registrarAusencia, anularAusencia } from "./actions";
import { emptyState, type ActionState } from "./shared";

export type Option = { id: string; label: string; national_id: string };

export type TypeOption = {
  code: string;
  name: string;
  reference: string | null;
  categoryCode: string | null;
  requiresDocument: boolean;
  hasEventWindow: boolean;
  manual: boolean;
};

export type AbsenceRow = {
  id: string;
  person: string;
  type_code: string;
  type_name: string;
  date_from: string;
  date_to: string;
  computed_days: number;
  observation: string | null;
  event_key: string | null;
  created_by: string;
  active: number;
};

type Saldo = {
  type: { name: string; reference: string | null; notes: string | null };
  basis: string;
  daysInRange: number;
  tiers: {
    label: string | null;
    window: string;
    limitDays: number | null;
    usedDays: number;
    remainingDays: number | null;
    payRate: number;
  }[];
  totalRemainingDays: number | null;
  excessDays: number;
  blocked: boolean;
  warnings: string[];
};

function Aviso({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && <div className="notice bad" style={{ marginBottom: 14 }}>{state.error}</div>}
      {state.message && <div className="notice ok" style={{ marginBottom: 14 }}>{state.message}</div>}
      {state.warning && <div className="notice warn" style={{ marginBottom: 14 }}>{state.warning}</div>}
    </>
  );
}

export default function LicenciasPanel({
  nivel,
  people,
  types,
  rows,
  puedeEscribir,
}: {
  nivel: string;
  people: Option[];
  types: TypeOption[];
  rows: AbsenceRow[];
  puedeEscribir: boolean;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [formState, registrar, guardando] = useActionState(registrarAusencia, emptyState);
  const [anularState, anular] = useActionState(anularAusencia, emptyState);

  const [personId, setPersonId] = useState("");
  const [typeCode, setTypeCode] = useState(types[0]?.code ?? "");
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [evento, setEvento] = useState("");
  const [saldo, setSaldo] = useState<Saldo | null>(null);

  const tipo = types.find((t) => t.code === typeCode);
  // Agotar la cuota justo es válido; lo que no se puede es pasarse.
  const noEntra = Boolean(
    saldo && saldo.totalRemainingDays !== null && saldo.daysInRange > saldo.totalRemainingDays
  );

  // El saldo se consulta mientras se completa el formulario, para verlo antes de guardar y no
  // descubrir el tope recién cuando el sistema rechaza la operación.
  useEffect(() => {
    if (!personId || !typeCode) {
      setSaldo(null);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ personId, typeCode, desde, hasta, evento });
    fetch(`/api/${encodeURIComponent(nivel)}/admin/saldo?${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setSaldo(data))
      .catch(() => {});
    return () => controller.abort();
  }, [nivel, personId, typeCode, desde, hasta, evento]);

  return (
    <>
      <Aviso state={formState} />
      <Aviso state={anularState} />

      {puedeEscribir && (
        <form action={registrar} className="card" style={{ marginBottom: 22 }}>
          <h2>Registrar licencia</h2>
          <input type="hidden" name="nivel" value={nivel} />
          <div className="form-grid">
            <div>
              <label htmlFor="personId">Agente</label>
              <select id="personId" name="personId" required value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">Elegir…</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>{person.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="typeCode">Tipo</label>
              <select id="typeCode" name="typeCode" required value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
                {types.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.reference ? `${type.reference} — ${type.name}` : type.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="desde">Desde</label>
              <input id="desde" name="desde" type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <label htmlFor="hasta">Hasta</label>
              <input id="hasta" name="hasta" type="date" required value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            {tipo?.manual && (
              <div>
                <label htmlFor="dias">Días</label>
                <input id="dias" name="dias" type="number" min={1} defaultValue={1} />
              </div>
            )}
            {tipo?.hasEventWindow && (
              <div>
                <label htmlFor="evento">Identificador del hecho</label>
                <input
                  id="evento"
                  name="evento"
                  value={evento}
                  onChange={(e) => setEvento(e.target.value)}
                  placeholder="accidente-2026"
                />
              </div>
            )}
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="observacion">Observación</label>
              <input id="observacion" name="observacion" placeholder="Opcional" />
            </div>
          </div>

          {tipo?.hasEventWindow && (
            <p className="muted" style={{ fontSize: 13 }}>
              Este tipo tiene topes por hecho. El identificador agrupa las licencias que
              corresponden al mismo episodio —un accidente, un embarazo—, aunque estén separadas
              en el tiempo o crucen el fin de año. Usá el mismo texto para todas.
            </p>
          )}
          {tipo?.requiresDocument && (
            <p className="muted" style={{ fontSize: 13 }}>Requiere certificación respaldatoria.</p>
          )}

          {saldo && (
            <div className={`notice ${noEntra ? "bad" : saldo.excessDays > 0 ? "warn" : "ok"}`} style={{ marginTop: 6 }}>
              <strong>
                {saldo.daysInRange} {saldo.daysInRange === 1 ? "día" : "días"} en el período
              </strong>{" "}
              <span style={{ opacity: 0.85 }}>({saldo.basis})</span>
              <br />
              {saldo.tiers.map((tier, index) => (
                <span key={index}>
                  {tier.label ?? `Tramo ${index + 1}`}: usados {tier.usedDays}
                  {tier.limitDays !== null && ` de ${tier.limitDays}`}
                  {tier.remainingDays !== null && ` · disponible ${tier.remainingDays}`}
                  {tier.payRate < 1 && ` · al ${Math.round(tier.payRate * 100)} %`}
                  <br />
                </span>
              ))}
              {saldo.excessDays > 0 && <>Excedente registrado: {saldo.excessDays}<br /></>}
              {noEntra && (
                <strong>
                  No entra: quedan {saldo.totalRemainingDays} y el período consume {saldo.daysInRange}.
                </strong>
              )}
            </div>
          )}

          <button type="submit" disabled={guardando || noEntra} style={{ width: "auto", padding: "12px 22px", marginTop: 4 }}>
            {guardando ? "Registrando…" : "Registrar"}
          </button>
        </form>
      )}

      <h2>Historial</h2>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <p className="empty">Todavía no hay licencias registradas.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Agente</th>
                <th>Tipo</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th className="num">Días</th>
                <th>Hecho</th>
                <th>Registró</th>
                {puedeEscribir && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={row.active ? undefined : { opacity: 0.5 }}>
                  <td>{row.person}</td>
                  <td title={row.observation ?? undefined}>
                    {row.type_name}
                    {!row.active && <> <span className="tag plain">Anulada</span></>}
                  </td>
                  <td>{row.date_from}</td>
                  <td>{row.date_to}</td>
                  <td className="num">{row.computed_days}</td>
                  <td>{row.event_key ?? "—"}</td>
                  <td>{row.created_by}</td>
                  {puedeEscribir && (
                    <td>
                      {row.active === 1 && (
                        <form action={anular}>
                          <input type="hidden" name="nivel" value={nivel} />
                          <input type="hidden" name="id" value={row.id} />
                          <button className="linkish" type="submit">Anular</button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
