import { redirect } from "next/navigation";
import { sessionWith } from "@/lib/session";
import { formatTime, zonedParts } from "@/core/platform/time";
import { pendingIntervals } from "@/core/attendance/service";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  last_name: string;
  first_name: string;
  national_id: string;
  start_time: string;
  end_time: string;
  entry_at: string | null;
  exit_at: string | null;
  late_minutes: number | null;
  pending_minutes: number | null;
  exit_type: string | null;
  absence_code: string | null;
};

/** Día ISO de una fecha civil: lunes = 1, domingo = 7. */
function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function minutes(value: number | null | undefined): string {
  return value ? `${value} min` : "—";
}

export default async function HoyPage({
  params,
  searchParams,
}: {
  params: Promise<{ nivel: string }>;
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { nivel } = await params;
  const session = await sessionWith(nivel, "attendance.read");
  if (!session) redirect(`/${nivel}/ingresar`);

  const { db } = session.resolved.context;
  const { timeZone } = session.resolved.context;
  const locale = session.resolved.level.locale;

  const today = zonedParts(timeZone).date;
  const { fecha } = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fecha ?? "") ? fecha! : today;

  const rows = db
    .prepare(
      `SELECT p.id, p.last_name, p.first_name, p.national_id,
              s.start_time, s.end_time,
              d.entry_at, d.exit_at, d.late_minutes, d.pending_minutes, d.exit_type,
              (SELECT t.code FROM absence_records r
                 JOIN absence_types t ON t.id = r.absence_type_id
                WHERE r.person_id = p.id AND r.active = 1
                  AND ? BETWEEN r.date_from AND r.date_to
                LIMIT 1) AS absence_code
       FROM people p
       JOIN person_schedules s ON s.person_id = p.id AND s.weekday = ?
       LEFT JOIN attendance_days d ON d.person_id = p.id AND d.work_date = ?
       WHERE p.active = 1
       ORDER BY p.last_name, p.first_name`
    )
    .all(date, isoWeekday(date), date) as unknown as Row[];

  const pendientes = pendingIntervals(session.resolved.context, date);

  const conLicencia = rows.filter((r) => r.absence_code).length;
  const presentes = rows.filter((r) => r.entry_at).length;
  const ausentes = rows.filter((r) => !r.entry_at && !r.absence_code).length;
  const tardanzas = rows.filter((r) => (r.late_minutes ?? 0) > 0).length;
  const abiertas = rows.filter((r) => r.entry_at && !r.exit_at).length;

  const fechaLarga = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

  function estado(row: Row) {
    if (row.absence_code) return <span className="tag warn">Licencia {row.absence_code}</span>;
    if (!row.entry_at) {
      return date < today
        ? <span className="tag bad">Ausente</span>
        : <span className="tag plain">Sin marcar</span>;
    }
    if (!row.exit_at) return <span className="tag warn">En jornada</span>;
    if (row.exit_type === "AUTO") return <span className="tag plain">Cerrada automáticamente</span>;
    return <span className="tag ok">Completa</span>;
  }

  return (
    <>
      <form className="toolbar" method="get">
        <div>
          <label htmlFor="fecha">Fecha</label>
          <input id="fecha" name="fecha" type="date" defaultValue={date} />
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <button type="submit">Ver</button>
        </div>
      </form>

      <p className="muted" style={{ marginTop: -6 }}>{fechaLarga}</p>

      <div className="stats">
        <div className="stat"><b>{rows.length}</b><span>Con horario</span></div>
        <div className="stat"><b>{presentes}</b><span>Marcaron entrada</span></div>
        <div className="stat"><b>{ausentes}</b><span>{date < today ? "Ausentes" : "Sin marcar"}</span></div>
        <div className="stat"><b>{tardanzas}</b><span>Con tardanza</span></div>
        <div className="stat"><b>{conLicencia}</b><span>Con licencia</span></div>
      </div>

      {abiertas > 0 && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          Hay {abiertas} {abiertas === 1 ? "jornada abierta" : "jornadas abiertas"} sin salida
          registrada. Si corresponde, el cierre automático las va a imputar al horario previsto.
        </div>
      )}

      {pendientes.length > 0 && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          {pendientes.length}{" "}
          {pendientes.length === 1 ? "salida intermedia espera" : "salidas intermedias esperan"}{" "}
          clasificación. Falta definir el motivo y si computan como tiempo trabajado.
        </div>
      )}

      <div className="table-wrap">
        {rows.length === 0 ? (
          <p className="empty">
            Nadie tiene horario asignado para este día.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Agente</th>
                <th>Documento</th>
                <th>Horario</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th className="num">Tardanza</th>
                <th className="num">Adeudado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.last_name}, {row.first_name}</td>
                  <td>{row.national_id}</td>
                  <td>{row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}</td>
                  <td>{formatTime(timeZone, locale, row.entry_at)}</td>
                  <td>{formatTime(timeZone, locale, row.exit_at)}</td>
                  <td className="num">{minutes(row.late_minutes)}</td>
                  <td className="num">{minutes(row.pending_minutes)}</td>
                  <td>{estado(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
