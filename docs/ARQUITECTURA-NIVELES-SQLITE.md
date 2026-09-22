# Arquitectura por nivel sobre SQLite

Cambio de rumbo respecto del plan original, decidido después de las primeras dos entregas. Lo que
sigue reemplaza a la fase 2 de [`REFACTOR-AGNOSTICO.md`](./REFACTOR-AGNOSTICO.md); el resto del
plan se mantiene.

## Qué cambia

| | Plan original | Ahora |
|---|---|---|
| Inquilino | Una organización, identificada por `organization_id` en cada tabla | **Un nivel, identificado por su archivo** |
| Motor | PostgreSQL en Neon | SQLite, un archivo por nivel |
| Despliegue | Vercel | Servidor propio |
| Alcance | Migrar el sistema existente | **Sistema nuevo.** El actual sigue en producción sin tocarse |

## Por qué simplifica tanto

La fase 2 era la única con riesgo de pérdida de datos: agregar `organization_id` a todas las
tablas de dominio y migrar los registros existentes. Con un archivo por nivel eso desaparece.
`primaria.db` contiene los datos de primaria y nada más; el esquema queda plano, sin una columna
que alguien pueda olvidarse de filtrar en una consulta.

Las consecuencias prácticas:

- **El aislamiento es físico.** No depende de que cada `SELECT` tenga su `WHERE`. Un error de
  programación no puede mostrarle a Primaria los datos de Secundaria.
- **El backup es copiar un archivo.** Por nivel, y se puede restaurar uno sin tocar el otro.
- **La misma persona puede existir en dos niveles** sin que el documento choque, porque las
  unicidades son locales a cada archivo.
- **No hay datos que migrar**, porque es un sistema nuevo.

El precio es que no hay consultas que crucen niveles. Si más adelante hiciera falta un reporte
consolidado, SQLite permite `ATTACH DATABASE` para leer varios archivos a la vez; no es gratis,
pero existe la salida.

## Estructura

```
data/
  platform.db        registro de niveles y operadores de plataforma
  primaria.db        todo lo de Primaria
  secundaria.db      todo lo de Secundaria
```

`platform.db` es deliberadamente mínimo: qué niveles existen, en qué archivo vive cada uno, y
quién puede crearlos. Ningún dato operativo. Los administradores de cada nivel viven dentro del
archivo de su nivel — es lo que da "un administrador por nivel" sin que nadie pueda cruzarse.

## Módulos nuevos

| Archivo | Qué hace |
|---|---|
| `core/platform/sqlite.ts` | Apertura de bases, PRAGMA de arranque, transacciones, conversiones |
| `core/tenancy/levels.ts` | Registro de niveles (`platform.db`) |
| `core/migrations/level-schema.ts` | Esquema completo de un nivel y catálogo de permisos |
| `packs/install.ts` | Aplicación de un paquete de reglas a un nivel |
| `core/absence/repository.ts` | Lectura de reglas y consumo para el evaluador |
| `core/platform/secrets.ts` | Hashes con `scrypt` de Node y tokens, sin dependencias externas |
| `core/platform/geo.ts` | Distancia entre coordenadas |
| `core/config/store.ts` | Lectura y escritura de la configuración del nivel |
| `core/attendance/service.ts` | Flujo completo de marcación: QR, PIN, dispositivo, geocerca, jornada |
| `scripts/demo-sqlite.ts` | Prueba de la capa de datos |
| `scripts/demo-attendance.ts` | Prueba del flujo de asistencia |

Los evaluadores de `core/absence/quota.ts`, `core/absence/entitlement.ts`,
`core/attendance/policy.ts` y `core/platform/time.ts` **no cambiaron ni una línea**. Son funciones
puras, sin SQL: el cambio de motor no las toca. Ése era exactamente el objetivo del refactor.

## Decisiones técnicas

**`node:sqlite`, no `better-sqlite3`.** Viene incorporado en Node, así que no hay que instalar ni
compilar nada — importante para un servidor chico que alguien más va a tener que mantener. Es
estable desde Node 24; en Node 22 funciona pero emite una advertencia de función experimental.
**El servidor debería correr Node 24.**

**Modo WAL.** Sin él, cada marcación bloquea las consultas del panel. Con WAL, las lecturas
siguen funcionando mientras se escribe. Como además hay un archivo por nivel, las escrituras de
Primaria y Secundaria ni siquiera compiten entre sí.

**Claves foráneas activadas explícitamente.** SQLite las declara pero no las verifica salvo que
se active `PRAGMA foreign_keys = ON` en cada conexión. Está en `openDatabase()`, y la prueba lo
verifica.

**Instantes en UTC, texto ISO-8601.** SQLite no tiene tipo fecha. Guardar en UTC y convertir a la
zona del nivel al mostrar es lo que evita repetir el error del sistema anterior, que concatenaba
un offset fijo de `-03:00`.

## Una mejora que trajo el rediseño

`absence_records` ahora tiene `event_key`: identifica el hecho que origina la ausencia —un
embarazo, un accidente, un duelo—. El sistema anterior no lo tenía, y por eso los topes "por
evento" se calculaban contra el acumulado anual: un Art. 8 inc. b que cruzaba el 31 de diciembre
se reiniciaba solo. Ahora la ventana EVENT se computa como corresponde. La prueba lo verifica con
un caso de 400 días a caballo de dos años.

## Lo que hay que resolver antes de desplegar

**La geolocalización exige HTTPS.** Los navegadores bloquean `navigator.geolocation` en sitios sin
certificado. Si el servidor queda accesible como `http://192.168.1.50:3000`, los celulares no van
a poder marcar: la pantalla va a pedir la ubicación y fallar siempre. Hace falta un dominio con
certificado, o un túnel. Es la restricción más importante del despliegue nuevo y conviene
resolverla temprano, no el día de la puesta en marcha.

**Respaldos.** Copiar un `.db` mientras se está escribiendo puede dar un archivo inconsistente.
Lo correcto es `VACUUM INTO` o la API de backup de SQLite, que producen una copia consistente sin
detener el servicio.

## Verificación

```
node --experimental-strip-types scripts/demo-sqlite.ts
```

Crea dos niveles reales, les instala el paquete, carga personas y ausencias, y comprueba 35
condiciones: saldos por tramos, ventana por evento, topes anuales y mensuales simultáneos,
aislamiento entre niveles, idempotencia de la instalación y verificación de claves foráneas.

## El servicio de asistencia

`core/attendance/service.ts` reemplaza a `lib/attendance.ts` con tres diferencias de fondo:

1. **La zona horaria viene del nivel**, no de una constante.
2. **Los eventos son la única fuente de verdad.** `attendance_days` es una proyección que se
   recalcula siempre con la misma función, `recomputeDay()`. En el sistema anterior el cálculo de
   tardanza estaba escrito tres veces —registro de entrada, recálculo del panel y marcación
   manual— y una de las copias ni siquiera leía la configuración. Ahora no puede haber dos
   resultados distintos para los mismos eventos.
3. **La política es un dato**: tolerancia, compensación, cierre automático y secuencia de
   movimientos salen de `attendance_policies`.

También se aclaró la semántica de los intervalos. Toda salida abre uno, pero sólo los **cerrados
por un reingreso** son ausencias intermedias que corresponde clasificar. Un intervalo abierto al
final del día no es un caso pendiente: es el fin de la jornada. `pendingIntervals()` devuelve
únicamente los que de verdad esperan decisión administrativa.

Otra diferencia: las contraseñas y los PIN usan `scrypt` de Node en lugar de bcryptjs. No agrega
una dependencia que haya que instalar en el servidor, y bcryptjs es JavaScript puro, bastante más
lento que la implementación nativa.

## Dónde vive el código

El sistema nuevo está en `sistema/`, como proyecto Next independiente con su propio
`package.json`. La aplicación de la raíz —la que está en producción sobre Vercel y Neon— no se
toca y sigue funcionando igual. Cuando convenga, `sistema/` se mueve a un repositorio propio
copiando la carpeta.

Los módulos que habían quedado del rumbo anterior (PostgreSQL y multi-inquilino por columna) se
eliminaron, y los que tenían sufijo `-sqlite` lo perdieron: ya no hay dos implementaciones que
distinguir.

## La aplicación web

| Ruta | Qué es |
|---|---|
| `/` | Lista de niveles activos |
| `/{nivel}` | Pantalla pública con el QR rotativo, reloj y cuenta regresiva |
| `/{nivel}/marcar?t=…` | Flujo de marcación en el celular |
| `POST /api/{nivel}/mark/status` | Identifica y dice qué movimiento corresponde |
| `POST /api/{nivel}/mark/submit` | Registra el movimiento |

El servidor recalcula el movimiento que corresponde antes de registrar y rechaza la petición si
no coincide con el que el cliente creía: entre que se mostró la pantalla y se tocó el botón pudo
cambiar el estado, y no debe registrarse algo distinto de lo que la persona vio.

Las conexiones SQLite se guardan en un caché en `globalThis`, porque en desarrollo Next recarga
los módulos en cada cambio y sin eso se abrirían conexiones nuevas hasta agotar los descriptores
de archivo.

## Qué falta

La sesión de usuario y el módulo de administración. Los niveles, las sedes y los administradores
se crean hoy por línea de comandos (`npm run nivel:crear`); las personas y sus horarios todavía
no tienen pantalla de carga.
