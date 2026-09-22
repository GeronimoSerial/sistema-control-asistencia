/**
 * Emisión del QR de una sede.
 *
 * La pantalla pública lo consulta periódicamente. Cada llamada emite un token nuevo con la
 * vigencia configurada, de modo que una foto del código deje de servir enseguida.
 */

import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { resolveLevel, mainLocation } from "@/lib/levels";
import { issueQrToken, purgeExpiredTokens } from "@/core/attendance/service";
import { getSetting } from "@/core/config/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ nivel: string }> }
) {
  const { nivel } = await params;
  const resolved = resolveLevel(nivel);
  if (!resolved) return NextResponse.json({ error: "Nivel inexistente" }, { status: 404 });

  const location = mainLocation(resolved.context.db);
  if (!location) {
    return NextResponse.json(
      { error: "El nivel todavía no tiene una sede configurada" },
      { status: 409 }
    );
  }

  const ttl = Number(getSetting<number>(resolved.context.db, "attendance.qr_ttl_minutes", location.id) ?? 5);
  purgeExpiredTokens(resolved.context);
  const { token, expiresAt } = issueQrToken(resolved.context, location.id, ttl);

  const url = new URL(request.url);
  const markUrl = `${url.origin}/${nivel}/marcar?t=${encodeURIComponent(token)}`;
  const image = await QRCode.toDataURL(markUrl, { margin: 1, width: 520 });

  return NextResponse.json({
    image,
    expiresAt,
    ttlMinutes: ttl,
    now: new Date().toISOString(),
    location: { name: location.name },
  });
}
