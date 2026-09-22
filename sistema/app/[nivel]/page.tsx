import { notFound } from "next/navigation";
import { resolveLevel, mainLocation } from "@/lib/levels";
import QrScreen from "./QrScreen";

export const dynamic = "force-dynamic";

/**
 * Pantalla pública del nivel: exhibe el QR de la sede.
 *
 * No requiere autenticación — se proyecta en un monitor a la entrada. Lo que protege la marcación
 * no es el acceso a esta pantalla sino la combinación de token vigente, PIN, dispositivo
 * vinculado y ubicación dentro de la geocerca.
 */
export default async function NivelPage({
  params,
}: {
  params: Promise<{ nivel: string }>;
}) {
  const { nivel } = await params;
  const resolved = resolveLevel(nivel);
  if (!resolved) notFound();

  const location = mainLocation(resolved.context.db);

  return (
    <main>
      <div className="shell">
        <div className="center">
          {resolved.branding.kicker && <div className="kicker">{resolved.branding.kicker}</div>}
          <h1>{resolved.branding.name}</h1>
          {location && <p className="muted">{location.name}</p>}
        </div>

        {location ? (
          <QrScreen
            nivel={nivel}
            timeZone={resolved.context.timeZone}
            locale={resolved.level.locale}
          />
        ) : (
          <div className="notice warn">
            Este nivel todavía no tiene una sede con ubicación configurada, así que no puede emitir
            el código. Cargala desde la administración del nivel.
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
