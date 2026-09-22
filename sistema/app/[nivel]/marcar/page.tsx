import { notFound } from "next/navigation";
import { resolveLevel } from "@/lib/levels";
import MarkClient from "./MarkClient";

export const dynamic = "force-dynamic";

export default async function MarcarPage({
  params,
  searchParams,
}: {
  params: Promise<{ nivel: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { nivel } = await params;
  const { t } = await searchParams;
  const resolved = resolveLevel(nivel);
  if (!resolved) notFound();

  return (
    <main>
      <div className="shell">
        <div className="center">
          {resolved.branding.kicker && <div className="kicker">{resolved.branding.kicker}</div>}
          <h1>{resolved.branding.name}</h1>
        </div>
        <MarkClient nivel={nivel} token={t ?? ""} />
      </div>
      <div className="footer">{resolved.branding.footer}</div>
    </main>
  );
}
