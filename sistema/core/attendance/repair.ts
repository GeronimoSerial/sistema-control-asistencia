/**
 * Reparación de las jornadas que dañó el cierre automático.
 *
 * El cierre imputaba la salida al horario previsto sin comprobar que fuera posterior al último
 * movimiento, y eso dejó dos formas de jornada rota:
 *
 * - **Salidas automáticas apiladas.** La salida quedaba ordenada entre medio de los movimientos,
 *   la jornada no cerraba, y cada corrida insertaba otra. Sobran todas menos una.
 * - **Salida automática antes de la entrada.** Ahí la secuencia ni siquiera es una jornada
 *   posible, y `sequenceProblem` bloquea cualquier corrección de ese día para siempre.
 *
 * En los dos casos la reparación es la misma: anular las salidas automáticas que sobran. No se
 * borra nada —quedan con su motivo, como cualquier anulación— y no se inventa ninguna salida: la
 * jornada vuelve a estar abierta, que es lo que era antes de que el cierre la tocara, y queda
 * para que alguien la resuelva desde Registros.
 *
 * Es idempotente: sobre una base sana no hace nada.
 */

import type { LevelContext } from "@/core/attendance/service";
import { recomputeDay } from "@/core/attendance/service";

export type RepairReport = {
  /** Jornadas tocadas. */
  days: number;
  /** Salidas automáticas anuladas. */
  voided: number;
  detail: { dayId: number; personId: string; workDate: string; problem: string; voided: number }[];
};

type EventRow = { id: number; event_type: string; occurred_at: string };

export function repairAutoCloses(
  ctx: LevelContext,
  options: { actor?: string; dryRun?: boolean } = {}
): RepairReport {
  const actor = options.actor ?? "REPARACION";
  const report: RepairReport = { days: 0, voided: 0, detail: [] };

  const days = ctx.db
    .prepare(
      `SELECT DISTINCT d.id, d.person_id, d.work_date
       FROM attendance_days d
       JOIN attendance_events e ON e.attendance_day_id = d.id
       WHERE e.event_type = 'AUTO_EXIT' AND e.voided_at IS NULL
       ORDER BY d.work_date, d.id`
    )
    .all() as unknown as { id: number; person_id: string; work_date: string }[];

  for (const day of days) {
    const movements = ctx.db
      .prepare(
        `SELECT id, event_type, occurred_at FROM attendance_events
         WHERE attendance_day_id = ? AND voided_at IS NULL
           AND event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT')
         ORDER BY occurred_at, id`
      )
      .all(day.id) as unknown as EventRow[];

    const autos = movements.filter((movement) => movement.event_type === "AUTO_EXIT");
    if (!autos.length) continue;

    // Una salida automática sobra cuando no es el último movimiento de la jornada: si hay algo
    // después, no cerró nada.
    const last = movements[movements.length - 1];
    const sobrantes = autos.filter((movement) => movement.id !== last.id);

    // Y si la única que queda está antes de la entrada, también sobra: esa secuencia no es una
    // jornada, y mientras exista el día es incorregible.
    const entry = movements.find((movement) => movement.event_type === "ENTRY");
    if (last.event_type === "AUTO_EXIT" && (!entry || last.occurred_at < entry.occurred_at)) {
      sobrantes.push(last);
    }

    if (!sobrantes.length) continue;

    const problem = sobrantes.length === autos.length && autos.length === 1
      ? "AUTO_EXIT_ANTES_DE_LA_ENTRADA"
      : "AUTO_EXIT_APILADAS";

    report.days += 1;
    report.voided += sobrantes.length;
    report.detail.push({
      dayId: day.id,
      personId: day.person_id,
      workDate: day.work_date,
      problem,
      voided: sobrantes.length,
    });

    if (options.dryRun) continue;

    const now = new Date().toISOString();
    const voidIt = ctx.db.prepare(
      `UPDATE attendance_events SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?`
    );
    for (const movement of sobrantes) {
      voidIt.run(now, actor, "Cierre automático que no correspondía (reparación)", movement.id);
    }

    ctx.db
      .prepare(
        `UPDATE attendance_days SET auto_close_processed_at = NULL, auto_close_blocked_reason = NULL
         WHERE id = ?`
      )
      .run(day.id);

    recomputeDay(ctx, day.id);
  }

  return report;
}
