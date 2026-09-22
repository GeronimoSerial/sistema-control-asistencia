/**
 * Valores y tipos compartidos entre la acción y la pantalla.
 *
 * Un archivo `"use server"` sólo puede exportar funciones asíncronas: todo lo demás que la
 * pantalla necesita del mismo lugar vive acá, en un módulo común que ambos lados importan.
 */

export type ActionState = { error: string | null; message: string | null };

export const emptyState: ActionState = { error: null, message: null };
