import { redirect } from "next/navigation";
import { platformDb } from "@/lib/levels";
import { countActiveOperators } from "@/core/tenancy/operators";
import { currentOperator } from "@/lib/platform-session";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function IngresarPlataformaPage() {
  if (await currentOperator()) redirect("/plataforma");

  // Sin operadores no hay nadie que pueda entrar, y una pantalla de alta abierta acá sería una
  // puerta sin llave. Se explica el comando en vez de ofrecer el alta.
  const sinOperadores = countActiveOperators(platformDb()) === 0;

  return (
    <main>
      <div className="shell">
        <div className="center">
          <div className="kicker">Plataforma</div>
          <h1>Administración de niveles</h1>
          <p className="muted">Alta y baja de niveles del sistema</p>
        </div>

        {sinOperadores ? (
          <div className="card">
            <p>Todavía no hay ningún operador de plataforma. Creá el primero desde el servidor:</p>
            <pre
              style={{
                overflowX: "auto",
                fontSize: 13,
                background: "rgba(0,0,0,.04)",
                padding: 12,
                borderRadius: 8,
              }}
            >
              npm run operador:crear -- --email tu@correo --clave &quot;una contraseña larga&quot;
            </pre>
            <p className="muted" style={{ fontSize: 13 }}>
              Es el único paso que queda por línea de comandos, y se hace una sola vez. Después los
              operadores se administran desde esta misma pantalla.
            </p>
          </div>
        ) : (
          <LoginForm />
        )}
      </div>
      <div className="footer">Sistema de control de asistencia</div>
    </main>
  );
}
