## V1.22

Marcación manual excepcional, nuevo rol Operador de Asistencia y tolerancia de tardanza de 15 minutos con cómputo total al excederla.

# Sistema de Control de Asistencia DGE · V1.9

Aplicación institucional para la Dirección de Gestión Escolar.

## Cambio principal V1.9

La ruta inicial `/` es ahora una pantalla pública de exhibición del QR dinámico de oficina. No requiere autenticación administrativa. El QR se renueva automáticamente cuando vence y muestra cuenta regresiva, fecha y hora de la oficina.

La administración continúa protegida en `/admin/login`.

## Flujo de marcación

Pantalla pública QR → escaneo desde celular → geolocalización → PIN → dispositivo autorizado → entrada/salida.

## Actualización

Subir el contenido de esta carpeta al repositorio GitHub conectado a Vercel. No reinicializar la base de datos y no modificar las variables de entorno.

## V1.10 — Reinicio de datos de prueba

Se agregó en Administración → Configuración una herramienta protegida para limpiar los datos operativos de prueba sin ejecutar SQL manualmente. Requiere escribir `REINICIAR` para confirmar. Conserva personal, horarios, configuración de la oficina, catálogo de licencias y PINs. Elimina asistencias, novedades/licencias/vacaciones cargadas, vínculos de dispositivos, QR históricos y auditoría de prueba; luego registra el propio reinicio en auditoría.


## V1.11
- Identificador estable de dispositivo guardado en el navegador del celular.
- Evita falsos bloqueos por regeneración de cookies al volver a escanear el QR.
- Mantiene fallback por cookie cuando el almacenamiento local no está disponible.
- Para dispositivos ya afectados por la implementación anterior, desvincular una sola vez desde Administración y volver a escanear.


## V1.13 — Importación histórica de licencias 2026

Se incorpora un módulo de revisión controlada del PDF `LICENCIAS 2026-comprimido.pdf` de 265 páginas. La aplicación registra cada página como fuente, preidentifica agentes cuando el DNI/nombre pudo cruzarse con el padrón y exige confirmación administrativa antes de crear una licencia histórica. Conserva página de origen, nivel de confianza y texto OCR de referencia.

Ruta: `/admin/importacion-licencias`.


## Cambios V1.13
- Nuevo rol **Operador de Licencias** con usuario y contraseña propios.
- Nueva sección **Usuarios y permisos** para crear/desactivar usuarios y resetear contraseñas.
- El operador solo puede consultar agentes y registrar/consultar licencias y vacaciones; las APIs sensibles quedan bloqueadas.
- Se agregan Art. 30 inc. a (nacimiento), b (razones particulares) y c (donación de sangre).
- Panel de saldo por tipo de licencia: usados, disponibles y excesos anual/mensual, con tramos especiales para Art. 8 a, 8 b/c, Art. 12 y Art. 13 bis.
- Vacaciones Arts. 4 y 5: cálculo de derecho de referencia 20/25/30/35 días según antigüedad y proporcional 1/12 para interinos con menos de 6 meses de servicios reales. Las fechas siguen siendo de carga manual.
- Cada carga de licencia/vacaciones conserva el usuario que la registró y queda auditada.

## V1.18 — Legajo integral
Se incorpora un módulo Legajos para consultar por agente su situación, antigüedad, horarios, PIN/dispositivo, asistencia, ausencias, tardanzas, licencias médicas, administrativas y vacaciones. Licencias y vacaciones incorpora filtros de historial por categoría y agente.


## V1.20
Generación masiva de PIN provisorios para agentes activos sin PIN, con vencimiento a 7 días, cambio obligatorio en primer uso y exportación CSV de entrega única.


## V1.21
Se incorpora secuencia de movimientos múltiples por jornada: Entrada → Salida → Reingreso → Salida. Las salidas intermedias quedan pendientes de clasificación por Administración, que puede asignar motivo, observación y definir si el intervalo computa como tiempo trabajado. El legajo muestra la secuencia completa.


## V1.22.1 — Inicio oficial del cómputo de inasistencias
Las inasistencias se contabilizan desde el 12/09/2026. Los días hasta el 11/09/2026 inclusive no generan ausencias históricas. Las marcaciones y licencias reales anteriores se conservan.


## V1.23
Permisos múltiples y editables por usuario. Un usuario puede combinar Licencias y Asistencia; preparado para nuevos permisos futuros.
