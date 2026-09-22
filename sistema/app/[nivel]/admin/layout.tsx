import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { endSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Guardia del panel.
 *
 * La verificación está en el layout y no en cada página: así una pantalla nueva queda protegida
 * por el solo hecho de colgar de acá, sin que nadie tenga que acordarse de agregarle el control.
 * Los permisos finos sí se verifican en cada pantalla, porque son distintos en cada una.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ nivel: string }>;
}) {
  const { nivel } = await params;
  const session = await currentSession(nivel);
  if (!session) redirect(`/${nivel}/ingresar`);

  const { user, resolved } = session;

  async function salir() {
    "use server";
    const { nivel: slug } = await params;
    await endSession(slug);
    redirect(`/${slug}/ingresar`);
  }

  const links: { href: string; label: string; permission: string }[] = [
    { href: `/${nivel}/admin`, label: "Hoy", permission: "attendance.read" },
    { href: `/${nivel}/admin/personal`, label: "Personal", permission: "people.read" },
  ];

  return (
    <main>
      <div className="admin-shell">
        <div className="admin-top">
          <div>
            {resolved.branding.kicker && <div className="kicker">{resolved.branding.kicker}</div>}
            <h1>{resolved.branding.name}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="muted">{user.name ?? user.email}</span>
            <form action={salir}>
              <button className="secondary" style={{ width: "auto", padding: "8px 16px", fontSize: 14 }}>
                Salir
              </button>
            </form>
          </div>
        </div>

        <nav className="admin-nav">
          {links
            .filter((link) => user.permissions.includes(link.permission))
            .map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
        </nav>

        {children}
      </div>
    </main>
  );
}
