# Actualización V1.25.3

## Corrección administrativa de horarios

Se incorpora en **Registros de asistencia** la posibilidad de que el Administrador corrija la hora de una marcación existente (Entrada, Salida, Reingreso o Salida automática) cuando exista una contingencia excepcional.

- La hora original no se elimina: queda preservada en los metadatos del movimiento y en la auditoría.
- El motivo de la corrección es obligatorio.
- Motivos disponibles: ubicación/GPS fuera de rango, problema de dispositivo/PIN, falla técnica, olvido o imposibilidad de marcar, autorización administrativa u otro motivo.
- Si se elige Otro motivo, la observación es obligatoria.
- El sistema impide que la hora corregida cruce el movimiento anterior o posterior de la misma jornada.
- Después de la corrección se recalculan tardanza, compensación, saldo y los horarios de los intervalos de salida/reingreso.
- Los movimientos corregidos se identifican visualmente como **Corregido**, mostrando la hora original y el responsable de la corrección.
- La función está disponible únicamente para el Administrador.

No se eliminan registros ni se modifican licencias, vacaciones, personal o horarios de prestación.
