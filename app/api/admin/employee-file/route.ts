import { NextResponse } from "next/server";
import { getAdminSession, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureV119LeaveDetailSchema } from "@/lib/migrations";

function validDate(v:string|null){return !!v&&/^\d{4}-\d{2}-\d{2}$/.test(v)}

export async function GET(request:Request){
  await ensureV119LeaveDetailSchema();
  const session=await getAdminSession(); if(!isAdmin(session))return NextResponse.json({error:"No autorizado"},{status:403});
  const u=new URL(request.url),employeeId=u.searchParams.get("employeeId")||"";
  const year=new Date().getFullYear();
  const from=validDate(u.searchParams.get("from"))?u.searchParams.get("from")!:`${year}-01-01`;
  const to=validDate(u.searchParams.get("to"))?u.searchParams.get("to")!:`${year}-12-31`;
  if(!employeeId||to<from)return NextResponse.json({error:"Parámetros inválidos"},{status:400});
  const sql=db();
  const officeSettings=(await sql`SELECT absence_count_start_date::text AS absence_count_start_date FROM office_settings WHERE id=1`)[0];
  const absenceStart=String(officeSettings?.absence_count_start_date||'2026-09-12');
  const employee=(await sql`
    SELECT e.id,e.last_name,e.first_name,e.dni,e.employment,e.active,e.seniority_date::text,e.seniority_notes,
      CASE WHEN e.seniority_date IS NULL THEN NULL ELSE EXTRACT(YEAR FROM age(current_date,e.seniority_date))::int END AS seniority_years,
      (e.pin_hash IS NOT NULL) AS pin_configured,e.force_pin_change,e.pin_changed_at,e.pin_change_source,e.pin_reset_count,
      COALESCE((SELECT json_agg(json_build_object('weekday',s.weekday,'start_time',left(s.start_time::text,5),'end_time',left(s.end_time::text,5)) ORDER BY s.weekday) FROM employee_schedules s WHERE s.employee_id=e.id),'[]'::json) AS schedules,
      (SELECT COUNT(*)::int FROM employee_devices d WHERE d.employee_id=e.id AND d.active=TRUE) AS active_devices,
      (SELECT to_char(MAX(d.last_seen_at) AT TIME ZONE 'America/Argentina/Buenos_Aires','DD/MM/YYYY HH24:MI') FROM employee_devices d WHERE d.employee_id=e.id AND d.active=TRUE) AS device_last_seen
    FROM employees e WHERE e.id=${employeeId}`)[0];
  if(!employee)return NextResponse.json({error:"Agente no encontrado"},{status:404});

  const leaves=await sql`
    SELECT l.id,l.leave_type,l.leave_type_id,l.date_from::text,l.date_to::text,l.observation,l.computed_days,l.warning_text,l.created_by,l.created_at,
      l.source_article,l.quantity_value,l.quantity_unit,
      t.code,t.name AS type_name,COALESCE(t.article,l.source_article) AS article,t.category,t.annual_limit,t.monthly_limit,t.event_limit,t.pay_rule
    FROM leave_records l LEFT JOIN leave_types t ON t.id=l.leave_type_id
    WHERE l.employee_id=${employeeId} AND l.active=TRUE AND l.date_to>=${from}::date AND l.date_from<=${to}::date
    ORDER BY l.date_from DESC,l.id DESC`;

  const attendance=await sql`
    WITH dates AS (
      SELECT d::date AS work_date
      FROM generate_series(${from}::date,${to}::date,'1 day'::interval) d
    ), base AS (
      SELECT dt.work_date,
        s.start_time AS schedule_start,s.end_time AS schedule_end,
        ad.id AS attendance_id,ad.scheduled_start AS actual_start,ad.scheduled_end AS actual_end,
        ad.entry_at,ad.exit_at,ad.late_minutes,ad.compensation_minutes,ad.pending_minutes,ad.exit_type
      FROM dates dt
      LEFT JOIN employee_schedules s ON s.employee_id=${employeeId} AND s.weekday=EXTRACT(ISODOW FROM dt.work_date)::int
      LEFT JOIN attendance_days ad ON ad.employee_id=${employeeId} AND ad.work_date=dt.work_date
      WHERE ad.id IS NOT NULL OR EXISTS (
        SELECT 1 FROM leave_records l WHERE l.employee_id=${employeeId} AND l.active=TRUE AND dt.work_date BETWEEN l.date_from AND l.date_to
      ) OR (s.employee_id IS NOT NULL AND dt.work_date >= ${absenceStart}::date)
    )
    SELECT b.work_date::text,
      left(COALESCE(b.actual_start,b.schedule_start)::text,5) AS scheduled_start,
      left(COALESCE(b.actual_end,b.schedule_end)::text,5) AS scheduled_end,
      to_char(b.entry_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI') AS entry_local,
      to_char(b.exit_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI') AS exit_local,
      COALESCE(b.late_minutes,0)::int AS late_minutes,COALESCE(b.compensation_minutes,0)::int AS compensation_minutes,
      COALESCE(b.pending_minutes,0)::int AS pending_minutes,b.exit_type,
      COALESCE((SELECT json_agg(json_build_object('id',ae.id,'event_type',ae.event_type,'time',to_char(ae.occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI')) ORDER BY ae.occurred_at,ae.id) FROM attendance_events ae WHERE ae.attendance_day_id=b.attendance_id AND ae.event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT')),'[]'::json) AS movements,
      COALESCE((SELECT json_agg(json_build_object('id',ai.id,'exit_time',to_char(ai.exited_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI'),'reentry_time',to_char(ai.reentered_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI'),'minutes',CASE WHEN ai.reentered_at IS NULL THEN NULL ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (ai.reentered_at-ai.exited_at))/60))::int END,'reason_code',ai.reason_code,'admin_note',ai.admin_note,'counts_as_work',ai.counts_as_work) ORDER BY ai.exited_at) FROM attendance_intervals ai WHERE ai.attendance_day_id=b.attendance_id AND ai.reentered_at IS NOT NULL),'[]'::json) AS intervals,
      lr.leave_type,lr.type_name,lr.article,lr.category,
      CASE WHEN b.entry_at IS NOT NULL THEN 'PRESENT'
           WHEN lr.id IS NOT NULL THEN 'JUSTIFIED'
           WHEN b.schedule_start IS NOT NULL AND b.work_date<CURRENT_DATE THEN 'ABSENT'
           ELSE 'PENDING' END AS status
    FROM base b
    LEFT JOIN LATERAL (
      SELECT l.id,l.leave_type,t.name AS type_name,COALESCE(t.article,l.source_article) AS article,t.category
      FROM leave_records l LEFT JOIN leave_types t ON t.id=l.leave_type_id
      WHERE l.employee_id=${employeeId} AND l.active=TRUE AND b.work_date BETWEEN l.date_from AND l.date_to
      ORDER BY l.created_at DESC LIMIT 1
    ) lr ON TRUE
    ORDER BY b.work_date DESC`;

  const a=attendance as any[];
  const summary={
    scheduled:a.filter(r=>r.status!=="PENDING").length,
    present:a.filter(r=>r.status==="PRESENT").length,
    justified:a.filter(r=>r.status==="JUSTIFIED").length,
    absent:a.filter(r=>r.status==="ABSENT").length,
    lateEntries:a.filter(r=>Number(r.late_minutes)>0).length,
    effectiveLate:a.filter(r=>Number(r.pending_minutes)>0).length,
    lateMinutes:a.reduce((s,r)=>s+Number(r.late_minutes||0),0),
    compensatedMinutes:a.reduce((s,r)=>s+Number(r.compensation_minutes||0),0),
    pendingMinutes:a.reduce((s,r)=>s+Number(r.pending_minutes||0),0),
    autoExits:a.filter(r=>r.exit_type==="AUTO").length
  };
  const l=leaves as any[];
  const leaveSummary={
    medicalDays:l.filter(r=>r.leave_type==="MEDICAL"||r.category==="MEDICAL").reduce((s,r)=>s+Number(r.computed_days||0),0),
    administrativeDays:l.filter(r=>r.leave_type==="ADMINISTRATIVE"||r.category==="ADMINISTRATIVE").reduce((s,r)=>s+Number(r.computed_days||0),0),
    vacationDays:l.filter(r=>r.leave_type==="VACATION").reduce((s,r)=>s+Number(r.computed_days||0),0),
    totalRecords:l.length
  };
  const entitlements=await sql`SELECT benefit_year,seniority_years,service_months,entitlement_days,notes FROM vacation_entitlements WHERE employee_id=${employeeId} ORDER BY benefit_year DESC`;
  return NextResponse.json({employee,from,to,absenceStartDate:absenceStart,summary,leaveSummary,leaves,attendance,entitlements});
}
