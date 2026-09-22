/**
 * Identifica a la persona y devuelve qué movimiento le corresponde ahora.
 *
 * No registra nada: es la pantalla previa a la confirmación.
 */

import { NextResponse } from "next/server";
import { authorizeMarking, ACTION_LABELS, BLOCK_MESSAGES } from "@/lib/marking";
import { nextAction } from "@/core/attendance/service";
import { formatTime } from "@/core/platform/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ nivel: string }> }
) {
  const { nivel } = await params;
  const body = await request.json().catch(() => ({}));
  const auth = await authorizeMarking(nivel, body);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message, code: auth.code }, { status: auth.status });
  }

  const { context } = auth.resolved;
  const state = nextAction(context, auth.person.id);
  const locale = auth.resolved.level.locale;

  return NextResponse.json({
    person: {
      name: `${auth.person.first_name} ${auth.person.last_name}`,
      nationalId: auth.person.national_id,
    },
    action: state.action,
    actionLabel: state.action ? ACTION_LABELS[state.action] : null,
    blocked: state.reason ? BLOCK_MESSAGES[state.reason] : null,
    schedule: state.schedule
      ? { start: state.schedule.start_time, end: state.schedule.end_time }
      : null,
    day: state.day
      ? {
          entry: formatTime(context.timeZone, locale, state.day.entry_at),
          exit: formatTime(context.timeZone, locale, state.day.exit_at),
          lateMinutes: state.day.late_minutes,
        }
      : null,
    distanceMeters: auth.distance === null ? null : Math.round(auth.distance),
  });
}
