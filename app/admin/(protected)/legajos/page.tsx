"use client";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

const dayNames:Record<number,string>={1:"Lun",2:"Mar",3:"Mié",4:"Jue",5:"Vie",6:"Sáb",7:"Dom"};
function today(){return new Date().toISOString().slice(0,10)}
function yearStart(){return `${new Date().getFullYear()}-01-01`}
function statusLabel(s:string){return s==="PRESENT"?"Presente":s==="JUSTIFIED"?"Ausencia justificada":s==="ABSENT"?"Ausente sin justificar":"Pendiente"}
function Kpi({label,value,sub}:{label:string;value:any;sub?:string}){return <div className="kpi info"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{sub&&<div className="muted" style={{fontSize:12,marginTop:4}}>{sub}</div>}</div>}

export default function LegajosPage(){
  const [employees,setEmployees]=useState<any[]>([]),[employeeId,setEmployeeId]=useState(""),[data,setData]=useState<any>(null),[msg,setMsg]=useState(""),[q,setQ]=useState("");
  const [summaryRows,setSummaryRows]=useState<any[]>([]),[summaryLoading,setSummaryLoading]=useState(false),[absenceStart,setAbsenceStart]=useState("");
  const [from,setFrom]=useState(yearStart()),[to,setTo]=useState(today()),[senDate,setSenDate]=useState(""),[senNotes,setSenNotes]=useState("");
  useEffect(()=>{fetch("/api/admin/employees").then(r=>r.ok?r.json():[]).then(setEmployees)},[]);
  async function loadSummary(){
    setSummaryLoading(true);
    const r=await fetch(`/api/admin/employee-summary?from=${from}&to=${to}`);const b=await r.json().catch(()=>({rows:[]}));
    if(r.ok){setSummaryRows(b.rows||[]);setAbsenceStart(b.absenceStartDate||"");}else setMsg(b.error||"No se pudo cargar el resumen del personal");
    setSummaryLoading(false);
  }
  useEffect(()=>{loadSummary()},[]);
  async function load(id=employeeId){
    if(!id)return;setMsg("Cargando legajo…");
    const r=await fetch(`/api/admin/employee-file?employeeId=${encodeURIComponent(id)}&from=${from}&to=${to}`);const b=await r.json().catch(()=>({}));
    if(!r.ok){setMsg(b.error||"No se pudo cargar el legajo");return;}
    setData(b);setSenDate(b.employee.seniority_date||"");setSenNotes(b.employee.seniority_notes||"");setMsg("");
  }
  useEffect(()=>{if(employeeId)load(employeeId)},[employeeId]);
  const filtered=useMemo(()=>employees.filter(e=>`${e.last_name} ${e.first_name} ${e.dni}`.toLowerCase().includes(q.toLowerCase())),[employees,q]);
  const filteredSummary=useMemo(()=>summaryRows.filter(e=>`${e.last_name} ${e.first_name} ${e.dni}`.toLowerCase().includes(q.toLowerCase())),[summaryRows,q]);
  function setCurrentYear(){const y=new Date().getFullYear();setFrom(`${y}-01-01`);setTo(today())}
  function setCurrentMonth(){const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0");setFrom(`${y}-${m}-01`);setTo(today())}
  async function saveSeniority(ev:FormEvent){
    ev.preventDefault();if(!employeeId)return;
    const r=await fetch(`/api/admin/employees/${employeeId}/seniority`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({seniorityDate:senDate,seniorityNotes:senNotes})});
    const b=await r.json().catch(()=>({}));setMsg(r.ok?"Antigüedad guardada.":b.error||"No se pudo guardar");if(r.ok)await load();
  }
  const medical=(data?.leaves||[]).filter((r:any)=>r.leave_type==="MEDICAL"||r.category==="MEDICAL");
  const administrative=(data?.leaves||[]).filter((r:any)=>r.leave_type==="ADMINISTRATIVE"||r.category==="ADMINISTRATIVE");
  const vacations=(data?.leaves||[]).filter((r:any)=>r.leave_type==="VACATION");
  return <div className="stack">
    <div><h1 className="heading">Legajos del personal</h1><p className="subheading">Consulta integral por agente: asistencia, licencias, vacaciones, tardanzas, faltas, horarios, antigüedad, PIN y dispositivo.</p></div>
    <div className="card stack">
      <div className="form-row"><div><label className="label">Buscar agente</label><input className="input" placeholder="Apellido, nombre o DNI" value={q} onChange={e=>setQ(e.target.value)}/></div><div><label className="label">Seleccionar agente</label><select className="select" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Seleccionar…</option>{filtered.map(e=><option key={e.id} value={e.id}>{e.last_name}, {e.first_name} · DNI {e.dni}</option>)}</select></div></div>
      <div className="row" style={{alignItems:"flex-end",flexWrap:"wrap"}}><div><label className="label">Desde</label><input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div><div><label className="label">Hasta</label><input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div><button type="button" className="btn btn-secondary" onClick={setCurrentMonth}>Mes actual</button><button type="button" className="btn btn-secondary" onClick={setCurrentYear}>Año actual</button><button type="button" className="btn btn-primary" onClick={()=>{loadSummary();if(employeeId)load()}}>Actualizar período</button></div>
      {absenceStart&&<div className="muted" style={{fontSize:13}}>Las faltas se computan únicamente desde el {absenceStart.split("-").reverse().join("/")} y solo sobre días con prestación prevista ya finalizados.</div>}
    </div>
    <div className="card table-wrap">
      <div className="row" style={{marginBottom:10}}><div><h2 style={{margin:0}}>Resumen de faltas del personal</h2><div className="muted">Vista rápida del período seleccionado. Las faltas totales son la suma de justificadas e injustificadas.</div></div><div className="spacer"/>{summaryLoading&&<span className="muted">Actualizando…</span>}</div>
      <table><thead><tr><th>Agente</th><th>DNI</th><th>Faltas totales</th><th>Justificadas</th><th>Injustificadas</th><th>Tardanzas efectivas</th><th>Saldo atraso</th><th>Acción</th></tr></thead><tbody>{filteredSummary.length?filteredSummary.map((r:any)=><tr key={r.id}><td><strong>{r.last_name}, {r.first_name}</strong><div className="muted" style={{fontSize:12}}>{r.employment}</div></td><td>{r.dni}</td><td><strong>{r.total_absences}</strong></td><td><span className="badge info">{r.justified}</span></td><td>{r.unjustified>0?<span className="badge danger">{r.unjustified}</span>:<span className="badge good">0</span>}</td><td>{r.effective_late}</td><td>{r.pending_minutes} min</td><td><button type="button" className="btn btn-secondary" onClick={()=>setEmployeeId(String(r.id))}>Ver legajo</button></td></tr>):<tr><td colSpan={8} className="muted">No hay agentes que coincidan con la búsqueda.</td></tr>}</tbody></table>
    </div>
    {!data&&<div className="notice info">Seleccioná un agente o usá “Ver legajo” desde el resumen para abrir su ficha individual.</div>}
    {data&&<>
      <div className="card stack">
        <div className="row"><div><h2 style={{margin:0}}>{data.employee.last_name}, {data.employee.first_name}</h2><div className="muted">DNI {data.employee.dni} · {data.employee.employment} · {data.employee.active?"Activo":"Inactivo"}</div></div><div className="spacer"/><Link className="btn btn-primary" href="/admin/novedades">Registrar novedad</Link><Link className="btn btn-secondary" href="/admin/personal">Editar datos y horarios</Link></div>
        <div className="grid grid-4"><Kpi label="Antigüedad" value={data.employee.seniority_years===null?"Sin registrar":`${data.employee.seniority_years} años`}/><Kpi label="PIN" value={data.employee.pin_configured?(data.employee.force_pin_change?"Provisorio":"Configurado"):"Pendiente"}/><Kpi label="Dispositivo" value={data.employee.active_devices?"Vinculado":"Sin vincular"} sub={data.employee.device_last_seen?`Último uso: ${data.employee.device_last_seen}`:undefined}/><Kpi label="Situación" value={data.employee.active?"Activo":"Inactivo"}/></div>
        <div><strong>Horario semanal</strong><div className="muted" style={{marginTop:5}}>{(data.employee.schedules||[]).length?(data.employee.schedules||[]).map((s:any)=>`${dayNames[s.weekday]} ${s.start_time}–${s.end_time}`).join(" · "):"Sin horario cargado"}</div></div>
      </div>
      <form className="card stack" onSubmit={saveSeniority}><h2 style={{margin:0}}>Antigüedad reconocida</h2><p className="subheading">Esta fecha se utiliza para determinar el tramo de Licencia Ordinaria que corresponde.</p><div className="form-row"><div><label className="label">Fecha reconocida</label><input className="input" type="date" value={senDate} onChange={e=>setSenDate(e.target.value)}/></div><div><label className="label">Observación</label><input className="input" value={senNotes} onChange={e=>setSenNotes(e.target.value)} placeholder="Antecedente, resolución, aclaración…"/></div></div><button className="btn btn-primary" style={{alignSelf:"flex-start"}}>Guardar antigüedad</button>{msg&&<div className={`notice ${msg.includes("guardada")?"good":"info"}`}>{msg}</div>}</form>
      <div className="card stack"><div className="row"><div><h2 style={{margin:0}}>Asistencia y ausentismo</h2><div className="muted">Período: {from.split("-").reverse().join("/")} al {to.split("-").reverse().join("/")}</div></div><div className="spacer"/><button type="button" className="btn btn-secondary" onClick={()=>load()}>Actualizar legajo</button></div>
        <div className="grid grid-4"><Kpi label="Presentes" value={data.summary.present}/><Kpi label="Ausencias justificadas" value={data.summary.justified}/><Kpi label="Ausencias injustificadas" value={data.summary.absent}/><Kpi label="Ingresos con atraso" value={data.summary.lateEntries}/><Kpi label="Tardanzas efectivas" value={data.summary.effectiveLate}/><Kpi label="Min. de atraso" value={data.summary.lateMinutes}/><Kpi label="Min. compensados" value={data.summary.compensatedMinutes}/><Kpi label="Saldo no compensado" value={data.summary.pendingMinutes}/></div>
      </div>
      <div className="card stack"><h2 style={{margin:0}}>Licencias y vacaciones</h2><div className="grid grid-4"><Kpi label="Licencias médicas" value={`${data.leaveSummary.medicalDays} días`} sub={`${medical.length} registros`}/><Kpi label="Administrativas" value={`${data.leaveSummary.administrativeDays} días`} sub={`${administrative.length} registros`}/><Kpi label="Vacaciones" value={`${data.leaveSummary.vacationDays} días`} sub={`${vacations.length} registros`}/><Kpi label="Total novedades" value={data.leaveSummary.totalRecords}/></div>
        <h3>Licencias médicas</h3>{medical.length?<LeaveTable rows={medical}/>:<div className="notice info">No hay licencias médicas registradas para este agente en el período seleccionado. Si todavía no ejecutaste la importación histórica confirmada, hacelo desde <Link href="/admin/importacion-licencias"><strong>Importación histórica</strong></Link>.</div>}
        <h3>Licencias administrativas</h3>{administrative.length?<LeaveTable rows={administrative}/>:<div className="muted">Sin registros administrativos en el período.</div>}
        <h3>Vacaciones</h3>{vacations.length?<LeaveTable rows={vacations}/>:<div className="muted">Sin vacaciones registradas en el período.</div>}
        <h3>Todos los registros del período</h3>{(data.leaves||[]).length?<LeaveTable rows={data.leaves}/>:<div className="muted">Sin licencias ni vacaciones registradas en el período.</div>}
      </div>
      <div className="card table-wrap"><h2 style={{marginTop:0}}>Detalle diario</h2><table><thead><tr><th>Fecha</th><th>Horario</th><th>Movimientos</th><th>Estado</th><th>Atraso</th><th>Compensado</th><th>Saldo</th></tr></thead><tbody>{data.attendance.map((r:any)=><tr key={r.work_date}><td>{r.work_date}</td><td>{r.scheduled_start}–{r.scheduled_end}</td><td>{(r.movements||[]).length?<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{r.movements.map((m:any)=><span key={m.id} className={`badge ${m.event_type==="EXIT"||m.event_type==="AUTO_EXIT"?"warn":"info"}`}>{m.event_type==="ENTRY"?"Entrada":m.event_type==="REENTRY"?"Reingreso":m.event_type==="AUTO_EXIT"?"Salida automática":"Salida"} {m.time}</span>)}</div>:<span className="muted">Sin movimientos</span>}{(r.intervals||[]).map((i:any)=><div key={i.id} className="muted" style={{marginTop:5}}>Fuera {i.exit_time}–{i.reentry_time} · {i.minutes} min · {i.reason_code?intervalReason(i.reason_code):"motivo pendiente"}{i.counts_as_work===true?" · computa trabajado":i.counts_as_work===false?" · no computa trabajado":""}</div>)}</td><td>{statusLabel(r.status)}{r.status==="JUSTIFIED"&&<div className="muted">{r.article?`${r.article} · `:""}{r.type_name||r.leave_type}</div>}</td><td>{r.late_minutes||0} min</td><td>{r.compensation_minutes||0} min</td><td>{r.pending_minutes||0} min</td></tr>)}</tbody></table></div>
    </>}
  </div>;
}
function intervalReason(v:string){const m:Record<string,string>={PERSONAL:"Motivo personal",MEDICAL:"Atención médica",COMMISSION:"Comisión de servicio",AUTHORIZED_PERMISSION:"Permiso autorizado",LEAVE_HOURS:"Licencia por horas",UNJUSTIFIED:"Salida no justificada",OTHER:"Otra causa"};return m[v]||v}
function LeaveTable({rows}:{rows:any[]}){const qty=(r:any)=>r.quantity_value!==null&&r.quantity_value!==undefined?`${Number(r.quantity_value)} ${r.quantity_unit==="HOURS"?"h":"días"}`:(r.computed_days!==null&&r.computed_days!==undefined?`${r.computed_days} días`:"—");return <div className="table-wrap"><table><thead><tr><th>Tipo</th><th>Desde</th><th>Hasta</th><th>Cantidad</th><th>Observación</th><th>Cargado por</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.article||r.source_article||""}</strong>{(r.article||r.source_article)&&<br/>}{r.type_name||(r.leave_type==="VACATION"?"Vacaciones":r.leave_type==="MEDICAL"?"Licencia médica":"Licencia administrativa")}</td><td>{r.date_from}</td><td>{r.date_to}</td><td>{qty(r)}</td><td>{r.observation||"—"}{r.warning_text&&<div className="badge warn" style={{marginTop:4}}>{r.warning_text}</div>}</td><td>{r.created_by||"—"}</td></tr>)}</tbody></table></div>}
