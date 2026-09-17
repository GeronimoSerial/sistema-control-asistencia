"use client";

import { useEffect, useMemo, useState } from "react";

type Dashboard = {
  ready: boolean;
  date?: string;
  totals?: Record<string, number>;
  rows?: Array<Record<string, any>>;
  error?: string;
};

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    const res = await fetch("/api/admin/dashboard", { cache: "no-store" });
    const body = await res.json().catch(() => ({ ready: false, error: "Error de respuesta" }));
    setData(body);
  }

  useEffect(() => { load(); }, []);

  if (!data) return <div className="card">Cargando resumen…</div>;
  if (!data.ready) {
    return (
      <div className="stack">
        <div>
          <h1 className="heading">Resumen diario</h1>
          <p className="subheading">Estado general de la asistencia.</p>
        </div>
        <div className="notice warn">
          La base de datos todavía no está inicializada. Ingresá a <strong>Configuración</strong> para crear las tablas y cargar los 46 agentes.
        </div>
      </div>
    );
  }

  const t = data.totals || {};
  const filteredRows = useMemo(() => (data.rows || []).filter((r:any) => `${r.name || ""} ${r.dni || ""}`.toLowerCase().includes(q.trim().toLowerCase())), [data.rows, q]);
  return (
    <div className="stack">
      <div className="row">
        <div>
          <h1 className="heading">Resumen diario</h1>
          <p className="subheading">{data.date}</p>
        </div>
        <div className="spacer" />
        <button className="btn btn-secondary" onClick={load}>Actualizar</button>
      </div>

      <div className="grid grid-4">
        <div className="kpi info"><div className="kpi-label">Con prestación prevista</div><div className="kpi-value">{t.scheduled || 0}</div></div>
        <div className="kpi good"><div className="kpi-label">Presentes</div><div className="kpi-value">{t.present || 0}</div></div>
        <div className="kpi warn"><div className="kpi-label">Tardanzas</div><div className="kpi-value">{t.late || 0}</div></div>
        <div className="kpi bad"><div className="kpi-label">Ausentes</div><div className="kpi-value">{t.absent || 0}</div></div>
        <div className="kpi info"><div className="kpi-label">Licencias / vacaciones</div><div className="kpi-value">{t.leave || 0}</div></div>
        <div className="kpi info"><div className="kpi-label">Actualmente en oficina</div><div className="kpi-value">{t.inOffice || 0}</div></div>
        <div className="kpi warn"><div className="kpi-label">Sin salida registrada</div><div className="kpi-value">{t.open || 0}</div></div>
        <div className="kpi warn"><div className="kpi-label">Salidas automáticas</div><div className="kpi-value">{t.autoExit || 0}</div></div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 10, alignItems:"center", flexWrap:"wrap" }}>
          <strong>Detalle del día</strong>
          <span className="muted">Las ausencias se determinan solo para quienes tenían prestación prevista y no poseen novedad cargada.</span>
          <div className="spacer" />
          <div style={{minWidth:280,maxWidth:380,flex:"1 1 280px"}}><input className="input" placeholder="Buscar por apellido, nombre o DNI" value={q} onChange={e=>setQ(e.target.value)} /></div>
          {q&&<button type="button" className="btn btn-secondary" onClick={()=>setQ("")}>Limpiar</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agente</th><th>Horario</th><th>Entrada</th><th>Estado</th><th>Salida</th><th>Compensación</th><th>Saldo</th></tr></thead>
            <tbody>
              {filteredRows.map((r: any) => (
                <tr key={r.employeeId}>
                  <td><strong>{r.name}</strong><div className="muted">DNI {r.dni}</div></td>
                  <td>{r.schedule}</td>
                  <td>{r.entry || "—"}{r.lateMinutes > 0 && <div className="muted">+{r.lateMinutes} min</div>}</td>
                  <td><span className={`badge ${r.statusTone || "info"}`}>{r.status}</span></td>
                  <td>{r.exit || "—"}{r.exitType === "AUTO" && <div className="muted">Automática</div>}</td>
                  <td>{r.compensationMinutes || 0} min</td>
                  <td>{r.pendingMinutes || 0} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
