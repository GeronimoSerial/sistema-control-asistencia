import Link from "next/link";
import { activeLevels } from "@/lib/levels";

export const dynamic = "force-dynamic";

export default function Home() {
  const levels = activeLevels();

  return (
    <main>
      <div className="shell">
        <div>
          <div className="kicker">Control de asistencia</div>
          <h1>Niveles</h1>
        </div>

        {levels.length === 0 ? (
          <div className="card">
            <h2>Todavía no hay ningún nivel</h2>
            <p className="muted">
              Creá el primero desde la línea de comandos:
            </p>
            <pre className="muted" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
              npm run nivel:crear -- --slug primaria --nombre &quot;Nivel Primario&quot;
            </pre>
          </div>
        ) : (
          <div className="level-list">
            {levels.map((level) => (
              <Link key={level.id} href={`/${level.slug}`}>
                {level.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
