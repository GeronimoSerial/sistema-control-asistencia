/**
 * Valores y tipos compartidos entre la acción y la pantalla.
 *
 * Un archivo `"use server"` sólo puede exportar funciones asíncronas: todo lo demás que la
 * pantalla necesita del mismo lugar vive acá, en un módulo común que ambos lados importan.
 */

export type ActionState = { error: string | null; message: string | null };

export const emptyState: ActionState = { error: null, message: null };

/** Por qué hubo que registrar el movimiento a mano. */
export const MANUAL_REASONS = [
  { value: "BROKEN_PHONE", label: "Teléfono roto o sin batería" },
  { value: "DEVICE_PROBLEM", label: "Problema con el dispositivo vinculado" },
  { value: "SYSTEM_FAILURE", label: "Falla del sistema o de la conexión" },
  { value: "MISSED_MARK", label: "Olvido de marcación" },
  { value: "OTHER", label: "Otra causa" },
];

/** Qué fue la salida intermedia y si cuenta como tiempo trabajado. */
export const INTERVAL_REASONS = [
  { value: "COMMISSION", label: "Comisión de servicio", counts: true },
  { value: "AUTHORIZED_PERMISSION", label: "Permiso autorizado", counts: true },
  { value: "MEDICAL", label: "Atención médica", counts: true },
  { value: "LEAVE_HOURS", label: "Horas de licencia", counts: false },
  { value: "PERSONAL", label: "Motivo particular", counts: false },
  { value: "UNJUSTIFIED", label: "Sin justificar", counts: false },
  { value: "OTHER", label: "Otro", counts: false },
];
