# Actualización V1.22.1

## Corte oficial para inasistencias

- Se establece como fecha de inicio del cómputo de inasistencias el **12/09/2026**.
- Esto significa que **no se muestran ni contabilizan inasistencias hasta el 11/09/2026 inclusive**.
- No se borran marcaciones reales, licencias, vacaciones, movimientos ni tardanzas ya registradas.
- Si existió una marcación real o una licencia/vacación antes del 12/09, sigue visible en el legajo.
- Los días anteriores que solo tenían horario previsto y ninguna marcación/licencia dejan de aparecer como ausencias.

La fecha queda almacenada en `office_settings.absence_count_start_date` para mantener una única regla global.
