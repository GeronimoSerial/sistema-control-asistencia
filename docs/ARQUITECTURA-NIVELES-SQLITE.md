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
| `core/migrations/sqlite/level-schema.ts` | Esquema completo de un nivel y catálogo de permisos |
| `packs/install-sqlite.ts` | Aplicación de un paquete de reglas a un nivel |
| `core/absence/repository-sqlite.ts` | Lectura de reglas y consumo para el evaluador |
| `scripts/demo-sqlite.ts` | Prueba de punta a punta |

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

## Qué falta

El núcleo de datos está probado, pero el sistema nuevo todavía no tiene aplicación: faltan las
pantallas, la autenticación, el flujo de marcación con QR y el módulo de administración. El
siguiente paso natural es el registro de asistencia de punta a punta sobre esta base, porque es
lo que ejercita el modelo completo.
