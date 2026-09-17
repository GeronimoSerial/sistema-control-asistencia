import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const COOKIE_NAME = "dge_admin_session";
export type AppRole = "ADMIN" | "LICENSE_OPERATOR" | "ATTENDANCE_OPERATOR" | "CUSTOM";
export type AppPermission = "LICENSES" | "ATTENDANCE";

function authKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 24) throw new Error("AUTH_SECRET debe estar configurada y ser suficientemente larga");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(email: string, role: AppRole, userId?: number | null) {
  return new SignJWT({ email, role, userId: userId ?? null })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(authKey());
}

export async function setAdminSession(email: string, role: AppRole = "ADMIN", userId?: number | null) {
  const token = await createSessionToken(email, role, userId);
  const store = await cookies();
  store.set(COOKIE_NAME, token, { httpOnly:true, secure:process.env.NODE_ENV === "production", sameSite:"lax", path:"/", maxAge:60*60*12 });
}

export async function clearAdminSession() { const store = await cookies(); store.delete(COOKIE_NAME); }

export async function getAdminSession() {
  try {
    const store = await cookies(); const token = store.get(COOKIE_NAME)?.value; if (!token) return null;
    const { payload } = await jwtVerify(token, authKey());
    if (typeof payload.email !== "string") return null;
    const role = String(payload.role || "") as AppRole;
    if (!(["ADMIN","LICENSE_OPERATOR","ATTENDANCE_OPERATOR","CUSTOM"] as string[]).includes(role)) return null;
    const userId = typeof payload.userId === "number" ? payload.userId : null;

    // La cuenta administradora definida por variables de entorno conserva acceso total.
    if (role === "ADMIN" && userId === null) {
      return { email:payload.email, role, userId:null, permissions:["LICENSES","ATTENDANCE"] as AppPermission[], mustChangePassword:false };
    }

    // Los permisos se leen en cada solicitud para que una edición tenga efecto inmediato,
    // sin obligar al usuario a cerrar sesión y volver a ingresar.
    if (userId !== null) {
      const sql=db();
      const user=(await sql`SELECT id,email,role,active,must_change_password FROM app_users WHERE id=${userId} LIMIT 1`)[0];
      if(!user || !user.active) return null;
      const permissions=(await sql`SELECT p.code FROM app_user_permissions up JOIN app_permissions p ON p.code=up.permission_code WHERE up.user_id=${userId} AND p.active=TRUE ORDER BY p.code`).map((r:any)=>String(r.code)) as AppPermission[];
      return { email:String(user.email), role:String(user.role) as AppRole, userId:Number(user.id), permissions, mustChangePassword:Boolean(user.must_change_password) };
    }

    return null;
  } catch { return null; }
}

type Session = Awaited<ReturnType<typeof getAdminSession>>;
type NonNullSession = NonNullable<Session>;
export function isAdmin(session: Session): session is NonNullSession & { role: "ADMIN" } { return session?.role === "ADMIN"; }
export function hasPermission(session: Session, permission: AppPermission): session is NonNullSession {
  return Boolean(session && (session.role === "ADMIN" || session.permissions?.includes(permission)));
}
export function canManageLicenses(session: Session): session is NonNullSession { return hasPermission(session,"LICENSES"); }
export function canManageAttendance(session: Session): session is NonNullSession { return hasPermission(session,"ATTENDANCE"); }

export async function authenticateUser(email: string, password: string): Promise<{email:string;role:AppRole;userId:number|null;permissions:AppPermission[];mustChangePassword:boolean}|null> {
  const normalized=email.trim().toLowerCase();
  const expectedEmail=process.env.ADMIN_EMAIL?.trim().toLowerCase(); const expectedPassword=process.env.ADMIN_PASSWORD;
  if (expectedEmail && expectedPassword && normalized === expectedEmail && password === expectedPassword) return {email:expectedEmail,role:"ADMIN",userId:null,permissions:["LICENSES","ATTENDANCE"],mustChangePassword:false};
  try {
    const sql=db();
    const row=(await sql`SELECT id,email,password_hash,role,active,must_change_password FROM app_users WHERE lower(email)=lower(${normalized}) LIMIT 1`)[0];
    if(!row || !row.active || !(["ADMIN","LICENSE_OPERATOR","ATTENDANCE_OPERATOR","CUSTOM"] as string[]).includes(String(row.role))) return null;
    if(!(await bcrypt.compare(password,String(row.password_hash)))) return null;
    await sql`UPDATE app_users SET last_login_at=now(),updated_at=now() WHERE id=${Number(row.id)}`;
    const permissions=(await sql`SELECT p.code FROM app_user_permissions up JOIN app_permissions p ON p.code=up.permission_code WHERE up.user_id=${Number(row.id)} AND p.active=TRUE ORDER BY p.code`).map((r:any)=>String(r.code)) as AppPermission[];
    return {email:String(row.email),role:row.role as AppRole,userId:Number(row.id),permissions,mustChangePassword:Boolean(row.must_change_password)};
  } catch { return null; }
}

export async function pinLookup(pin: string) {
  const crypto = await import("node:crypto"); const secret = process.env.AUTH_SECRET || "";
  return crypto.createHmac("sha256", secret).update(`employee-pin:${pin}`).digest("hex");
}
