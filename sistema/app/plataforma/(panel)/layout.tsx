import { redirect } from "next/navigation";
import { currentOperator, endPlatformSession } from "@/lib/platform-session";

export const dynamic = "force-dynamic";

/**
 * Guardia del área de plataforma.
 *
 * Igual que en el panel de nivel, la verificación vive en el layout para que cualquier pantalla
 * nueva quede protegida por colgar de acá. La pantalla de ingreso no está bajo este layout, por
 * razones obvias: tiene su propia ruta hermana.
 */
export default async function PlataformaLayout({ children }: { children: React.ReactNode }) {
  const operator = await currentOperator();
  if (!operator) redirect("/plataforma/ingresar");

  async function salir() {
    "use server";
    await endPlatformSession();
    redirect("/plataforma/ingresar");
  }

  return (
    <main>
      <div className="admin-shell">
        <div className="admin-top">
          <div>
            <div className="kicker">Plataforma</div>
            <h1>Niveles del sistema</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="muted">{operator.name ?? operator.email}</span>
            <form action={salir}>
              <button className="secondary" style={{ width: "auto", padding: "8px 16px", fontSize: 14 }}>
                Salir
              </button>
            </form>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
