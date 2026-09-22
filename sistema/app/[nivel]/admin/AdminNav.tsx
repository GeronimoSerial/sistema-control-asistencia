"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavLink = { href: string; label: string };

/**
 * Navegación del panel.
 *
 * Es un componente de cliente sólo para poder marcar la pestaña activa: saber en qué ruta se está
 * requiere leer la URL del navegador. Qué enlaces se muestran lo decide el servidor, según los
 * permisos.
 */
export default function AdminNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="admin-nav">
      {links.map((link) => {
        // El panel del día está en la raíz, así que sólo coincide de forma exacta; el resto
        // también marca activo en sus subrutas.
        const active =
          pathname === link.href ||
          (link.href.split("/").length > 3 && pathname.startsWith(`${link.href}/`));
        return (
          <Link key={link.href} href={link.href} className={active ? "active" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
