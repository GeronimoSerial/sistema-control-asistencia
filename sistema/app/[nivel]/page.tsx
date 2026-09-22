import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveLevel } from "@/lib/levels";
import { listLocations } from "@/core/attendance/locations";
import QrScreen from "./QrScreen";

export const dynamic = "force-dynamic";

/**
 * Pantalla pública del nivel: exhibe el QR de la sede.
 *
 * No requiere autenticación — se proyecta en un monitor a la entrada. Lo que protege la marcación
 * no es el acceso a esta pantalla sino la combinación de token vigente, PIN, dispositivo
 * vinculado y ubicación dentro de la geocerca.
 *
 * Con varias sedes, cada una tiene su propia dirección (`?sede=CODIGO`) porque cada monitor se
 * queda fijo en la suya. El selector está para llegar a ella la primera vez, no para usarlo todos
 * los días.
 */
export default async function NivelPage({
  params,
  searchParams,
}: {
  params: Promise<{ nivel: string }>;
  searchParams: Promise<{ sede?: string }>;
}) {
  const { nivel } = await params;
  const resolved = resolveLevel(nivel);
  if (!resolved) notFound();

  const activas = listLocations(resolved.context.db, true);
  const { sede } = await searchParams;
  const elegida = sede
    ? activas.find((location) => location.code === sede.toUpperCase())
    : activas[0];

  return (
    <main>
      <div className="shell">
        <div className="center">
          {resolved.branding.kicker && <div className="kicker">{resolved.branding.kicker}</div>}
          <h1>{resolved.branding.name}</h1>
          {elegida && <p className="muted">{elegida.name}</p>}
        </div>

        {activas.length > 1 && (
          <div className="card center" style={{ marginBottom: 14 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Sede</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {activas.map((location) => (
                <Link
                  key={location.id}
                  href={`/${nivel}?sede=${encodeURIComponent(location.code)}`}
                  className={location.id === elegida?.id ? "tag ok" : "tag plain"}
                  style={{ textDecoration: "none" }}
                >
                  {location.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {sede && !elegida ? (
          <div className="notice bad">
            No hay ninguna sede activa con el código <code>{sede}</code> en este nivel.
          </div>
        ) : elegida ? (
          <QrScreen
            nivel={nivel}
            timeZone={resolved.context.timeZone}
            locale={resolved.level.locale}
            sede={elegida.code}
          />
        ) : (
          <div className="notice warn">
            Este nivel todavía no tiene ninguna sede activa, así que no puede emitir el código.
            Cargala desde Sedes, en la administración del nivel.
          </div>
        )}

        <div className="card center">
          <h2>Cómo marcar</h2>
          <p className="muted" style={{ margin: 0 }}>
            Escaneá el código con la cámara del celular, permití el acceso a la ubicación e
            ingresá tu PIN. El código se renueva solo: una foto no sirve.
          </p>
        </div>
      </div>
      <div className="footer">{resolved.branding.footer}</div>
    </main>
  );
}
