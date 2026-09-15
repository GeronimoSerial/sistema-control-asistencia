import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession,hasPermission,isAdmin } from "@/lib/auth";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession(); if (!session) redirect("/admin/login");
  const admin=isAdmin(session), licenses=hasPermission(session,"LICENSES"), attendance=hasPermission(session,"ATTENDANCE");
  const subtitle=admin?"Administración":licenses&&attendance?"Licencias + Asistencia":licenses?"Operador de Licencias":attendance?"Operador de Asistencia":"Usuario autorizado";
  return <>
    <header className="site-header"><div className="container site-header-inner"><div><div className="brand-kicker">Gobierno de Corrientes · Ministerio de Educación</div><div className="brand-title">Dirección de Gestión Escolar</div><div className="brand-subtitle">{subtitle} · Control de Asistencia</div></div><form action="/api/admin/logout" method="post"><button className="btn btn-secondary" type="submit">Cerrar sesión</button></form></div></header>
    <main className="main"><div className="container admin-shell"><nav className="admin-nav" aria-label="Administración">
      {admin&&<Link href="/admin">Resumen diario</Link>}
      {admin&&<Link href="/admin/personal">Personal</Link>}
      {admin&&<Link href="/admin/legajos">Legajos</Link>}
      {(admin||attendance)&&<Link href="/admin/registros">Registros</Link>}
      {(admin||licenses)&&<Link href="/admin/novedades">Licencias y vacaciones</Link>}
      {admin&&<Link href="/admin/importacion-licencias">Importación histórica</Link>}
      {admin&&<Link href="/admin/qr">QR de oficina</Link>}
      {admin&&<Link href="/admin/usuarios">Usuarios y permisos</Link>}
      {admin&&<Link href="/admin/configuracion">Configuración</Link>}
    </nav><section style={{ minWidth: 0 }}>{children}</section></div></main>
    <footer className="footer">Dirección de Gestión Escolar · Ministerio de Educación · Gobierno de Corrientes</footer>
  </>;
}
