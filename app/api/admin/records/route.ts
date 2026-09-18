import { NextResponse } from "next/server";
import { getAdminSession, isAdmin, canManageAttendance } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ensureV13Schema } from "@/lib/migrations";

const reasons=new Set(["PERSONAL","MEDICAL","COMMISSION","AUTHORIZED_PERMISSION","LEAVE_HOURS","UNJUSTIFIED","OTHER"]);
const manualReasons=new Set(["BROKEN_PHONE","DEVICE_PROBLEM","SYSTEM_FAILURE","OTHER"]);
const movementTypes=new Set(["ENTRY","EXIT","REENTRY"]);
const correctionReasons=new Set(["GEOLOCATION","DEVICE_PROBLEM","SYSTEM_FAILURE","MISSED_MARK","ADMIN_AUTHORIZATION","OTHER"]);
const editableMovementTypes=new Set(["ENTRY","EXIT","REENTRY","AUTO_EXIT"]);

function validDate(v:string){return /^\d{4}-\d{2}-\d{2}$/.test(v)}
function validTime(v:string){return /^([01]\d|2[0-3]):[0-5]\d$/.test(v)}
function minutes(v:string){const [h,m]=v.slice(0,5).split(":").map(Number);return h*60+m}


async function recalculateAttendanceDay(sql:any, dayId:number){
  const day=(await sql`SELECT id,work_date::text,scheduled_start::text,scheduled_end::text,exit_type FROM attendance_days WHERE id=${dayId} LIMIT 1`)[0];
  if(!day)return;
  const events=await sql`
    SELECT id,event_type,occurred_at,metadata,
           to_char(occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI') AS local_time
    FROM attendance_events
    WHERE attendance_day_id=${dayId} AND event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT')
    ORDER BY occurred_at,id
  `;
  const entry=events.find((e:any)=>String(e.event_type)==='ENTRY');
  if(!entry)return;
  const toleranceRow=(await sql`SELECT lateness_tolerance_minutes FROM office_settings WHERE id=1 LIMIT 1`)[0];
  const tolerance=Number(toleranceRow?.lateness_tolerance_minutes ?? 15);
  const start=String(day.scheduled_start).slice(0,5);
  const rawLate=Math.max(0,minutes(String(entry.local_time))-minutes(start));
  const late=rawLate>tolerance?rawLate:0;
  const last=events[events.length-1];
  if(last && ['EXIT','AUTO_EXIT'].includes(String(last.event_type))){
    const end=String(day.scheduled_end).slice(0,5);
    const exitLocal=String(last.local_time);
    const after=Math.max(0,minutes(exitLocal)-minutes(end));
    const early=Math.max(0,minutes(end)-minutes(exitLocal));
    const comp=Math.min(late,after);
    const pending=Math.max(0,late-comp)+early;
    await sql`UPDATE attendance_days SET entry_at=${entry.occurred_at},exit_at=${last.occurred_at},late_minutes=${late},early_minutes=${early},compensation_minutes=${comp},pending_minutes=${pending},updated_at=now() WHERE id=${dayId}`;
  }else{
    await sql`UPDATE attendance_days SET entry_at=${entry.occurred_at},exit_at=NULL,early_minutes=0,late_minutes=${late},compensation_minutes=0,pending_minutes=${late},updated_at=now() WHERE id=${dayId}`;
  }
  await sql`UPDATE attendance_intervals ai SET exited_at=ae.occurred_at,updated_at=now() FROM attendance_events ae WHERE ai.attendance_day_id=${dayId} AND ai.exit_event_id=ae.id`;
  await sql`UPDATE attendance_intervals ai SET reentered_at=ae.occurred_at,updated_at=now() FROM attendance_events ae WHERE ai.attendance_day_id=${dayId} AND ai.reentry_event_id=ae.id`;
}

export async function GET(request:Request){
  await ensureV13Schema();
  const session=await getAdminSession();if(!canManageAttendance(session))return NextResponse.json({error:"No autorizado"},{status:403});
  const url=new URL(request.url);
  if(url.searchParams.get("employees")==="1"){
    const sql=db();
    const employees=await sql`SELECT id,last_name,first_name,dni,employment FROM employees WHERE active=TRUE ORDER BY last_name,first_name`;
    return NextResponse.json(employees);
  }
  const date=url.searchParams.get("date");if(!date||!validDate(date))return NextResponse.json({error:"Fecha inválida"},{status:400});
  const sql=db();const rows=await sql`
    SELECT ad.id,e.last_name,e.first_name,e.dni,ad.scheduled_start::text,ad.scheduled_end::text,
      to_char(ad.entry_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI') AS entry_local,
      to_char(ad.exit_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI') AS exit_local,
      ad.late_minutes,ad.compensation_minutes,ad.pending_minutes,ad.exit_type,
      COALESCE((SELECT json_agg(json_build_object(
        'id',ae.id,'event_type',ae.event_type,
        'time',to_char(ae.occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI'),
        'manual',COALESCE((ae.metadata->>'manual')::boolean,false),
        'manual_reason',ae.metadata->>'manualReason','actor',ae.metadata->>'actor',
        'corrected',COALESCE((ae.metadata->>'corrected')::boolean,false),
        'original_time',ae.metadata->>'originalLocalTime',
        'correction_reason',ae.metadata->>'correctionReason',
        'correction_note',ae.metadata->>'correctionNote',
        'corrected_by',ae.metadata->>'correctedBy'
      ) ORDER BY ae.occurred_at,ae.id)
        FROM attendance_events ae WHERE ae.attendance_day_id=ad.id AND ae.event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT')),'[]'::json) AS movements,
      COALESCE((SELECT json_agg(json_build_object(
        'id',ai.id,
        'exit_time',to_char(ai.exited_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI'),
        'reentry_time',to_char(ai.reentered_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI'),
        'minutes',CASE WHEN ai.reentered_at IS NULL THEN NULL ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (ai.reentered_at-ai.exited_at))/60))::int END,
        'reason_code',ai.reason_code,'admin_note',ai.admin_note,'counts_as_work',ai.counts_as_work,
        'classified_by',ai.classified_by,'classified_at',ai.classified_at
      ) ORDER BY ai.exited_at) FROM attendance_intervals ai WHERE ai.attendance_day_id=ad.id AND ai.reentered_at IS NOT NULL),'[]'::json) AS intervals
    FROM attendance_days ad JOIN employees e ON e.id=ad.employee_id
    WHERE ad.work_date=${date}::date ORDER BY e.last_name,e.first_name
  `;return NextResponse.json(rows);
}

export async function POST(request:Request){
  await ensureV13Schema();
  const session=await getAdminSession();if(!canManageAttendance(session))return NextResponse.json({error:"No autorizado"},{status:403});
  const body=await request.json().catch(()=>({}));
  const employeeId=String(body.employeeId||"");const date=String(body.date||"");const time=String(body.time||"");
  const eventType=String(body.eventType||"");const manualReason=String(body.manualReason||"");const note=String(body.note||"").trim().slice(0,500);
  if(!employeeId||!validDate(date)||!validTime(time)||!movementTypes.has(eventType)||!manualReasons.has(manualReason))return NextResponse.json({error:"Complete agente, fecha, hora, movimiento y motivo."},{status:400});
  if(manualReason==="OTHER"&&!note)return NextResponse.json({error:"Para 'Otra causa' debe ingresar una observación."},{status:400});
  const sql=db();
  const employee=(await sql`SELECT id,last_name,first_name,dni,active FROM employees WHERE id=${employeeId} LIMIT 1`)[0];
  if(!employee||!employee.active)return NextResponse.json({error:"Agente inexistente o inactivo."},{status:404});
  const schedule=(await sql`
    SELECT start_time::text,end_time::text FROM employee_schedules
    WHERE employee_id=${employeeId} AND weekday=(EXTRACT(ISODOW FROM ${date}::date))::int LIMIT 1
  `)[0];
  if(!schedule)return NextResponse.json({error:"El agente no tiene horario registrado para esa fecha."},{status:409});
  const occurred=`${date} ${time}:00`;
  let day=(await sql`SELECT * FROM attendance_days WHERE employee_id=${employeeId} AND work_date=${date}::date LIMIT 1`)[0]||null;
  const last=day?(await sql`SELECT id,event_type,occurred_at FROM attendance_events WHERE attendance_day_id=${day.id} AND event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT') ORDER BY occurred_at DESC,id DESC LIMIT 1`)[0]:null;
  const metadata=JSON.stringify({manual:true,manualReason,actor:session!.email,note:note||null});

  if(eventType==="ENTRY"){
    if(day?.entry_at)return NextResponse.json({error:"La jornada ya tiene una entrada registrada."},{status:409});
    const start=String(schedule.start_time).slice(0,5);const raw=Math.max(0,minutes(time)-minutes(start));
    // Regla DGE: hasta 15 min no hay atraso; si se supera, se computa el total desde la hora prevista.
    const late=raw>15?raw:0;
    if(!day){
      day=(await sql`INSERT INTO attendance_days(employee_id,work_date,scheduled_start,scheduled_end,entry_at,late_minutes,pending_minutes,admin_note)
        VALUES(${employeeId},${date}::date,${start}::time,${String(schedule.end_time).slice(0,5)}::time,(${occurred}::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),${late},${late},${`Marcación manual: ${manualReason}${note?` - ${note}`:""}`}) RETURNING *`)[0];
    }else{
      day=(await sql`UPDATE attendance_days SET entry_at=(${occurred}::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),late_minutes=${late},pending_minutes=${late},admin_note=${`Marcación manual: ${manualReason}${note?` - ${note}`:""}`},updated_at=now() WHERE id=${day.id} RETURNING *`)[0];
    }
    await sql`INSERT INTO attendance_events(attendance_day_id,employee_id,event_type,occurred_at,metadata) VALUES(${day.id},${employeeId},'ENTRY',(${occurred}::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),${metadata}::jsonb)`;
  } else if(eventType==="EXIT"){
    if(!day?.entry_at)return NextResponse.json({error:"No puede registrar una salida sin una entrada previa."},{status:409});
    if(!last||!["ENTRY","REENTRY"].includes(String(last.event_type)))return NextResponse.json({error:"La secuencia actual no admite una salida."},{status:409});
    const end=String(day.scheduled_end).slice(0,5);const after=Math.max(0,minutes(time)-minutes(end));const early=Math.max(0,minutes(end)-minutes(time));const late=Number(day.late_minutes||0);const comp=Math.min(late,after);const pending=Math.max(0,late-comp)+early;
    day=(await sql`UPDATE attendance_days SET exit_at=(${occurred}::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),early_minutes=${early},compensation_minutes=${comp},pending_minutes=${pending},exit_type='ADMIN',admin_note=${`Marcación manual: ${manualReason}${note?` - ${note}`:""}`},updated_at=now() WHERE id=${day.id} RETURNING *`)[0];
    const ev=(await sql`INSERT INTO attendance_events(attendance_day_id,employee_id,event_type,occurred_at,metadata) VALUES(${day.id},${employeeId},'EXIT',(${occurred}::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),${metadata}::jsonb) RETURNING id,occurred_at`)[0];
    await sql`INSERT INTO attendance_intervals(attendance_day_id,employee_id,exit_event_id,exited_at) VALUES(${day.id},${employeeId},${ev.id},${ev.occurred_at})`;
  } else {
    if(!day?.entry_at)return NextResponse.json({error:"No puede registrar un reingreso sin una entrada previa."},{status:409});
    if(!last||String(last.event_type)!=="EXIT")return NextResponse.json({error:"La secuencia actual no admite un reingreso."},{status:409});
    const open=(await sql`SELECT id FROM attendance_intervals WHERE attendance_day_id=${day.id} AND reentered_at IS NULL ORDER BY exited_at DESC LIMIT 1`)[0];
    if(!open)return NextResponse.json({error:"No hay una salida abierta para asociar al reingreso."},{status:409});
    const ev=(await sql`INSERT INTO attendance_events(attendance_day_id,employee_id,event_type,occurred_at,metadata) VALUES(${day.id},${employeeId},'REENTRY',(${occurred}::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),${metadata}::jsonb) RETURNING id,occurred_at`)[0];
    await sql`UPDATE attendance_intervals SET reentry_event_id=${ev.id},reentered_at=${ev.occurred_at},updated_at=now() WHERE id=${open.id}`;
    await sql`UPDATE attendance_days SET exit_at=NULL,exit_latitude=NULL,exit_longitude=NULL,exit_accuracy=NULL,exit_distance_meters=NULL,early_minutes=0,compensation_minutes=0,pending_minutes=late_minutes,exit_type=NULL,admin_note=${`Marcación manual: ${manualReason}${note?` - ${note}`:""}`},updated_at=now() WHERE id=${day.id}`;
  }
  await writeAudit({actor:session!.email,action:"MANUAL_ATTENDANCE_MOVEMENT",entityType:"attendance_day",entityId:String(day.id),next:{employeeId,date,time,eventType,manualReason,note}});
  return NextResponse.json({ok:true,id:day.id});
}


export async function PUT(request:Request){
  await ensureV13Schema();
  const session=await getAdminSession();
  if(!isAdmin(session))return NextResponse.json({error:"Solo el administrador puede corregir horarios de marcación."},{status:403});
  const body=await request.json().catch(()=>({}));
  const eventId=Number(body.eventId);const time=String(body.time||"");const reasonCode=String(body.reasonCode||"");const note=String(body.note||"").trim().slice(0,500);
  if(!Number.isInteger(eventId)||eventId<=0||!validTime(time)||!correctionReasons.has(reasonCode))return NextResponse.json({error:"Complete una hora válida y el motivo de la corrección."},{status:400});
  if(reasonCode==="OTHER"&&!note)return NextResponse.json({error:"Para 'Otro motivo' debe ingresar una observación."},{status:400});
  const sql=db();
  const event=(await sql`
    SELECT ae.id,ae.attendance_day_id,ae.employee_id,ae.event_type,ae.occurred_at,ae.metadata,
           ad.work_date::text,
           to_char(ae.occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires','HH24:MI') AS local_time
    FROM attendance_events ae JOIN attendance_days ad ON ad.id=ae.attendance_day_id
    WHERE ae.id=${eventId} LIMIT 1
  `)[0];
  if(!event)return NextResponse.json({error:"Marcación no encontrada."},{status:404});
  if(!editableMovementTypes.has(String(event.event_type)))return NextResponse.json({error:"Este movimiento no admite corrección horaria."},{status:409});

  const movements=await sql`SELECT id,event_type,occurred_at FROM attendance_events WHERE attendance_day_id=${event.attendance_day_id} AND event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT') ORDER BY occurred_at,id`;
  const index=movements.findIndex((m:any)=>Number(m.id)===eventId);
  if(index<0)return NextResponse.json({error:"No se pudo ubicar la marcación dentro de la jornada."},{status:409});
  const correctedAt=new Date(`${String(event.work_date).slice(0,10)}T${time}:00-03:00`);
  if(Number.isNaN(correctedAt.getTime()))return NextResponse.json({error:"Hora de corrección inválida."},{status:400});
  const previousMovement=index>0?movements[index-1]:null;
  const nextMovement=index<movements.length-1?movements[index+1]:null;
  if(previousMovement && correctedAt.getTime()<=new Date(previousMovement.occurred_at).getTime())return NextResponse.json({error:"La hora corregida debe ser posterior al movimiento anterior."},{status:409});
  if(nextMovement && correctedAt.getTime()>=new Date(nextMovement.occurred_at).getTime())return NextResponse.json({error:"La hora corregida debe ser anterior al movimiento siguiente."},{status:409});

  const currentMetadata=(event.metadata&&typeof event.metadata==='object')?event.metadata:{};
  const nextMetadata={...currentMetadata,corrected:true,originalOccurredAt:currentMetadata.originalOccurredAt||event.occurred_at,originalLocalTime:currentMetadata.originalLocalTime||String(event.local_time),correctionReason:reasonCode,correctionNote:note||null,correctedBy:session!.email,correctedAt:new Date().toISOString()};
  const occurred=`${String(event.work_date).slice(0,10)} ${time}:00`;
  const updated=(await sql`UPDATE attendance_events SET occurred_at=(${occurred}::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),metadata=${JSON.stringify(nextMetadata)}::jsonb WHERE id=${eventId} RETURNING id,attendance_day_id,employee_id,event_type,occurred_at,metadata`)[0];
  await recalculateAttendanceDay(sql,Number(event.attendance_day_id));
  await writeAudit({actor:session!.email,action:"EDIT_ATTENDANCE_MOVEMENT_TIME",entityType:"attendance_event",entityId:String(eventId),previous:{...event},next:updated,reason:`${reasonCode}${note?` - ${note}`:""}`});
  return NextResponse.json({ok:true,event:updated});
}

export async function PATCH(request:Request){
  await ensureV13Schema();
  const session=await getAdminSession();if(!isAdmin(session))return NextResponse.json({error:"Solo el administrador puede clasificar salidas intermedias."},{status:403});
  const body=await request.json().catch(()=>({}));
  const id=Number(body.intervalId);const reason=String(body.reasonCode||"");
  if(!Number.isInteger(id)||id<=0||!reasons.has(reason))return NextResponse.json({error:"Datos de clasificación inválidos."},{status:400});
  const note=String(body.adminNote||"").trim().slice(0,500);
  const countsAsWork=body.countsAsWork===true;
  const sql=db();
  const previous=(await sql`SELECT * FROM attendance_intervals WHERE id=${id}`)[0];
  if(!previous)return NextResponse.json({error:"Intervalo no encontrado."},{status:404});
  if(!previous.reentered_at)return NextResponse.json({error:"La salida todavía no tiene reingreso registrado."},{status:409});
  const updated=(await sql`
    UPDATE attendance_intervals SET reason_code=${reason},admin_note=${note||null},counts_as_work=${countsAsWork},classified_by=${session!.email},classified_at=now(),updated_at=now()
    WHERE id=${id}
    RETURNING *
  `)[0];
  await writeAudit({actor:session!.email,action:"CLASSIFY_ATTENDANCE_INTERVAL",entityType:"attendance_interval",entityId:String(id),previous,next:updated});
  return NextResponse.json({ok:true,interval:updated});
}

export async function DELETE(request:Request){
  await ensureV13Schema();
  const session=await getAdminSession();
  if(!isAdmin(session))return NextResponse.json({error:"Solo el administrador puede eliminar registros de asistencia."},{status:403});
  const body=await request.json().catch(()=>({}));
  const ids=Array.isArray(body.ids)?[...new Set(body.ids.map((v:any)=>Number(v)).filter((v:number)=>Number.isInteger(v)&&v>0))]:[];
  if(!ids.length)return NextResponse.json({error:"Seleccione al menos un registro de asistencia."},{status:400});
  if(ids.length>200)return NextResponse.json({error:"Se pueden eliminar hasta 200 registros por operación."},{status:400});
  const sql=db();
  const previous=await sql`
    SELECT ad.*,e.last_name,e.first_name,e.dni
    FROM attendance_days ad JOIN employees e ON e.id=ad.employee_id
    WHERE ad.id IN (SELECT value::bigint FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
    ORDER BY ad.work_date,e.last_name,e.first_name
  `;
  if(!previous.length)return NextResponse.json({error:"No se encontraron los registros seleccionados."},{status:404});
  await sql`DELETE FROM attendance_intervals WHERE attendance_day_id IN (SELECT value::bigint FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
  await sql`DELETE FROM attendance_events WHERE attendance_day_id IN (SELECT value::bigint FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
  const deleted=await sql`DELETE FROM attendance_days WHERE id IN (SELECT value::bigint FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)) RETURNING id`;
  await writeAudit({actor:session!.email,action:"DELETE_ATTENDANCE_RECORDS",entityType:"attendance_day",entityId:ids.join(","),previous,next:{deletedIds:deleted.map((r:any)=>Number(r.id)),reason:String(body.reason||"Eliminación administrativa").slice(0,300)}});
  return NextResponse.json({ok:true,deleted:deleted.length,deletedIds:deleted.map((r:any)=>Number(r.id))});
}
