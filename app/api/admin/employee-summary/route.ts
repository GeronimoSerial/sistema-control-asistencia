import { NextResponse } from "next/server";
import { getAdminSession, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureV119LeaveDetailSchema } from "@/lib/migrations";

function validDate(v:string|null){return !!v&&/^\d{4}-\d{2}-\d{2}$/.test(v)}

export async function GET(request:Request){
  await ensureV119LeaveDetailSchema();
  const session=await getAdminSession();
  if(!isAdmin(session)) return NextResponse.json({error:"No autorizado"},{status:403});

  const u=new URL(request.url);
  const year=new Date().getFullYear();
  const from=validDate(u.searchParams.get("from"))?u.searchParams.get("from")!:`${year}-01-01`;
  const to=validDate(u.searchParams.get("to"))?u.searchParams.get("to")!:`${year}-12-31`;
  if(to<from) return NextResponse.json({error:"Período inválido"},{status:400});

  const sql=db();
  const settings=(await sql`SELECT absence_count_start_date::text AS absence_count_start_date FROM office_settings WHERE id=1`)[0];
  const absenceStart=String(settings?.absence_count_start_date||"2026-09-12");

  const rows=await sql`
    WITH params AS (
      SELECT GREATEST(${from}::date,${absenceStart}::date) AS date_from,
             LEAST(${to}::date,CURRENT_DATE-1) AS date_to
    ), scheduled AS (
      SELECT e.id AS employee_id,d::date AS work_date
      FROM employees e
      CROSS JOIN params p
      CROSS JOIN LATERAL generate_series(p.date_from,p.date_to,'1 day'::interval) d
      JOIN employee_schedules s ON s.employee_id=e.id AND s.weekday=EXTRACT(ISODOW FROM d)::int
      WHERE e.active=TRUE AND p.date_to>=p.date_from
    ), daily AS (
      SELECT sc.employee_id,sc.work_date,
        EXISTS(
          SELECT 1 FROM attendance_days ad
          WHERE ad.employee_id=sc.employee_id AND ad.work_date=sc.work_date AND ad.entry_at IS NOT NULL
        ) AS has_entry,
        EXISTS(
          SELECT 1 FROM leave_records l
          WHERE l.employee_id=sc.employee_id AND l.active=TRUE AND sc.work_date BETWEEN l.date_from AND l.date_to
        ) AS has_justification
      FROM scheduled sc
    ), absence_counts AS (
      SELECT employee_id,
        COUNT(*) FILTER (WHERE NOT has_entry AND has_justification)::int AS justified,
        COUNT(*) FILTER (WHERE NOT has_entry AND NOT has_justification)::int AS unjustified
      FROM daily GROUP BY employee_id
    ), late_counts AS (
      SELECT ad.employee_id,
        COUNT(*) FILTER (WHERE COALESCE(ad.late_minutes,0)>0)::int AS late_entries,
        COUNT(*) FILTER (WHERE COALESCE(ad.pending_minutes,0)>0)::int AS effective_late,
        COALESCE(SUM(ad.pending_minutes) FILTER (WHERE COALESCE(ad.pending_minutes,0)>0),0)::int AS pending_minutes
      FROM attendance_days ad, params p
      WHERE ad.work_date BETWEEN p.date_from AND p.date_to
      GROUP BY ad.employee_id
    )
    SELECT e.id,e.last_name,e.first_name,e.dni,e.employment,
      COALESCE(a.justified,0)::int AS justified,
      COALESCE(a.unjustified,0)::int AS unjustified,
      (COALESCE(a.justified,0)+COALESCE(a.unjustified,0))::int AS total_absences,
      COALESCE(l.late_entries,0)::int AS late_entries,
      COALESCE(l.effective_late,0)::int AS effective_late,
      COALESCE(l.pending_minutes,0)::int AS pending_minutes
    FROM employees e
    LEFT JOIN absence_counts a ON a.employee_id=e.id
    LEFT JOIN late_counts l ON l.employee_id=e.id
    WHERE e.active=TRUE
    ORDER BY e.last_name,e.first_name,e.dni
  `;

  return NextResponse.json({from,to,absenceStartDate:absenceStart,rows});
}
