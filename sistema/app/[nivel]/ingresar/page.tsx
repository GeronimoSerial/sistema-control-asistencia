import { notFound, redirect } from "next/navigation";
import { resolveLevel } from "@/lib/levels";
import { currentSession } from "@/lib/session";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function IngresarPage({
  params,
}: {
  params: Promise<{ nivel: string }>;
}) {
  const { nivel } = await params;
  const resolved = resolveLevel(nivel);
  if (!resolved) notFound();

  // Si ya hay sesión vigente no tiene sentido volver a pedir credenciales.
  if (await currentSession(nivel)) redirect(`/${nivel}/admin`);

  return (
    <main>
      <div className="shell">
        <div className="center">
          {resolved.branding.kicker && <div className="kicker">{resolved.branding.kicker}</div>}
          <h1>{resolved.branding.name}</h1>
          <p className="muted">Administración</p>
        </div>
        <LoginForm nivel={nivel} />
      </div>
      <div className="footer">{resolved.branding.footer}</div>
    </main>
  );
}
