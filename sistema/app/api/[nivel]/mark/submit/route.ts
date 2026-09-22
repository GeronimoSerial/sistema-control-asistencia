/**
 * Registra el movimiento.
 *
 * El cliente manda qué acción cree que corresponde, pero el servidor la vuelve a calcular y
 * rechaza la petición si no coinciden: entre que se mostró la pantalla y se tocó el botón pudo
 * cambiar el estado, y no debe registrarse algo distinto de lo que la persona vio.
 */

import { NextResponse } from "next/server";
import { authorizeMarking } from "@/lib/marking";
import {
  nextAction,
  markEntry,
  markExit,
  markReentry,
  MarkError,
} from "@/core/attendance/service";
import { formatTime } from "@/core/platform/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRMATIONS: Record<string, string> = {
  ENTRY: "Entrada registrada",
  EXIT: "Salida registrada",
  REENTRY: "Reingreso registrado",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ nivel: string }> }
) {
  const { nivel } = await params;
  const body = await request.json().catch(() => ({}));

  // La vinculación del dispositivo ocurre recién acá: sólo al registrar de verdad.
  const auth = await authorizeMarking(nivel, body, { bindDevice: true });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message, code: auth.code }, { status: auth.status });
  }

  const { context } = auth.resolved;
  const state = nextAction(context, auth.person.id);

  if (!state.action) {
    return NextResponse.json(
      { error: "No hay ningún movimiento pendiente.", code: state.reason ?? "NO_ACTION" },
      { status: 409 }
    );
  }
  if (body.action && body.action !== state.action) {
    return NextResponse.json(
      { error: "El estado cambió. Volvé a escanear el código.", code: "STATE_CHANGED" },
      { status: 409 }
    );
  }

  const input = {
    personId: auth.person.id,
    coordinates: body.coordinates ?? null,
    distanceMeters: auth.distance,
    source: "EMPLOYEE" as const,
  };

  try {
    const day =
      state.action === "ENTRY" ? markEntry(context, input)
      : state.action === "EXIT" ? markExit(context, input)
      : markReentry(context, input);

    const locale = auth.resolved.level.locale;
    return NextResponse.json({
      ok: true,
      action: state.action,
      title: CONFIRMATIONS[state.action],
      person: `${auth.person.first_name} ${auth.person.last_name}`,
      entry: formatTime(context.timeZone, locale, day.entry_at),
      exit: formatTime(context.timeZone, locale, day.exit_at),
      lateMinutes: day.late_minutes,
      deviceBoundNow: auth.deviceBoundNow,
    });
  } catch (error) {
    if (error instanceof MarkError) {
      return NextResponse.json(
        { error: "No se pudo registrar el movimiento.", code: error.code },
        { status: 409 }
      );
    }
    console.error("Error al registrar la marcación", error);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}
