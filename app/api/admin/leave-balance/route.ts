import {NextResponse} from "next/server";
import {getAdminSession,canManageLicenses} from "@/lib/auth";
import {ensureV13Schema} from "@/lib/migrations";
import {db} from "@/lib/db";
export async function GET(req:Request){
 await ensureV13Schema();const s=await getAdminSession();if(!canManageLicenses(s))return NextResponse.json({error:"No autorizado"},{status:403});
 const u=new URL(req.url),employeeId=u.searchParams.get("employeeId")||"",typeId=Number(u.searchParams.get("leaveTypeId")),date=u.searchParams.get("date")||new Date().toISOString().slice(0,10);
 if(!employeeId||!Number.isInteger(typeId))return NextResponse.json({error:"Parámetros inválidos"},{status:400});const sql=db();
 const t=(await sql`SELECT * FROM leave_types WHERE id=${typeId}`)[0];if(!t)return NextResponse.json({error:"Tipo inexistente"},{status:404});
 const year=Number(date.slice(0,4)),ym=date.slice(0,7);
 const annual=(await sql`SELECT COALESCE(SUM(computed_days),0)::int used FROM leave_records WHERE employee_id=${employeeId} AND leave_type_id=${typeId} AND active=TRUE AND EXTRACT(YEAR FROM date_from)=${year}`)[0];
 const monthly=(await sql`SELECT COALESCE(SUM(computed_days),0)::int used FROM leave_records WHERE employee_id=${employeeId} AND leave_type_id=${typeId} AND active=TRUE AND to_char(date_from,'YYYY-MM')=${ym}`)[0];
 const used=Number(annual.used||0),monthUsed=Number(monthly.used||0);const code=String(t.code);let detail:any={};
 if(code==="ART8A")detail={withPayUsed:Math.min(used,30),remainingWithPay:Math.max(30-used,0),excessWithoutPay:Math.max(used-30,0)};
 if(code==="ART12")detail={withPayUsed:Math.min(used,20),withoutPayUsed:Math.max(Math.min(used-20,20),0),remainingWithPay:Math.max(20-used,0),remainingWithoutPay:Math.max(40-Math.max(used,20),0),excess:Math.max(used-40,0)};
 if(code==="ART13BIS")detail={baseUsed:Math.min(used,15),extensionUsed:Math.max(Math.min(used-15,15),0),remainingBase:Math.max(15-used,0),remainingExtension:Math.max(30-Math.max(used,15),0),excess:Math.max(used-30,0)};
 if(code==="ART8B"||code==="ART8C")detail={fullPayUsed:Math.min(used,730),halfPayUsed:Math.max(Math.min(used-730,365),0),remainingFullPay:Math.max(730-used,0),remainingHalfPay:Math.max(1095-Math.max(used,730),0),excess:Math.max(used-1095,0)};
 return NextResponse.json({code,name:t.name,article:t.article,annualUsed:used,annualLimit:t.annual_limit?Number(t.annual_limit):null,annualRemaining:t.annual_limit?Math.max(Number(t.annual_limit)-used,0):null,annualExcess:t.annual_limit?Math.max(used-Number(t.annual_limit),0):0,monthlyUsed:monthUsed,monthlyLimit:t.monthly_limit?Number(t.monthly_limit):null,monthlyRemaining:t.monthly_limit?Math.max(Number(t.monthly_limit)-monthUsed,0):null,monthlyExcess:t.monthly_limit?Math.max(monthUsed-Number(t.monthly_limit),0):0,eventLimit:t.event_limit?Number(t.event_limit):null,extensionLimit:t.extension_limit?Number(t.extension_limit):null,detail});
}
