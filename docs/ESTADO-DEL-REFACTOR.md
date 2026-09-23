# Estado de la rama `refactor/agnostic-core`

Documento de lectura para quien revise esta rama. Qué hay, qué garantías tiene, cómo verificarlo
y qué decisiones quedan pendientes.

**Lo primero, porque cambia cómo leer todo lo demás:** la rama empezó como un refactor del sistema
actual y terminó siendo **una aplicación nueva, en la carpeta `sistema/`**. La aplicación que está
en producción, en la raíz del repositorio, no fue modificada. El único commit que la tocaba fue
revertido dentro de esta misma rama.

El plan original está en [`REFACTOR-AGNOSTICO.md`](./REFACTOR-AGNOSTICO.md) y la arquitectura de lo
que efectivamente se construyó, en
[`ARQUITECTURA-NIVELES-SQLITE.md`](./ARQUITECTURA-NIVELES-SQLITE.md).

---

## Por qué

El sistema funciona, pero está construido a medida de un organismo: las reglas del Estatuto del
Docente de Corrientes, la escala de vacaciones, la tolerancia de ingreso y la zona horaria están
escritas como código, no guardadas como datos. Cambiar un tope de días implica editar un archivo,
compilar y desplegar. Y la base tiene, literalmente, una restricción que impide que exista más de
una oficina:

```sql
CREATE TABLE office_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ...
)
```

El objetivo era separar **el motor** de **las reglas** para poder construir después un módulo de
administración que gestione organismos, configuración, catálogos y permisos sin tocar el
repositorio.

## Por qué cambió el camino

El plan original enchufaba el motor nuevo en la aplicación existente y después migraba a
multi-inquilino agregando `organization_id` a las tablas de dominio. Esa fase 2 era **la única con
riesgo de pérdida de datos**, y era inevitable mientras todo viviera en una sola base.

Al definirse que la administración iba a ser **por nivel** —primaria, secundaria— y que cada uno
correría sobre SQLite, esa fase desapareció: si cada nivel es un archivo, el aislamiento es una
propiedad del sistema de archivos y no de una columna que hay que agregar y rellenar. No hay
`organization_id` en ninguna tabla porque no hace falta.

El commit que enchufaba el motor en la aplicación de producción quedó revertido. Consecuencia
directa y deliberada: **la aplicación actual sigue exactamente como estaba**, con los problemas
que se describen más abajo incluidos.

---

## Garantías de esta rama

1. **No cambia el comportamiento de la aplicación en producción.** No hay un solo archivo
   modificado fuera de `sistema/`, `docs/` y `.gitignore`.
2. **No toca ninguna base existente.** El sistema nuevo crea sus propios archivos SQLite.
3. **Los cálculos están verificados contra los actuales.** Un script reimplementa la lógica
   anterior tal cual y compara: **875 comprobaciones, todas equivalentes**.
4. **Es descartable.** Borrar la carpeta `sistema/` deja el repositorio como estaba.

---

## Qué hay hoy

### El núcleo, en `sistema/core/`

Lógica de dominio pura: no importa nada de `next` ni de `app/`. Por eso las pruebas corren con
Node directo, sin servidor y sin base de datos externa.

- `absence/` — evaluador de cuotas por tramos y escalas de derecho por antigüedad.
- `attendance/` — política declarativa, servicio de marcación, corrección de movimientos, sedes.
- `config/` — registro tipado de parámetros, con ámbito, valor por defecto y validación.
- `identity/` — autenticación, roles y permisos.
- `tenancy/` — registro de niveles, alta completa de un nivel y operadores de plataforma.
- `platform/` — SQLite, tiempo con zona horaria, geodistancia, hashes.
- `migrations/` — esquema de la base de un nivel, con migración aditiva para las bases en uso.

### Las reglas, en `sistema/packs/`

`ar-corrientes-dge/pack.json` tiene 19 tipos de licencia, 27 tramos de cuota, la escala de
vacaciones, la política de asistencia y los roles. Como datos. Cambiar de organismo es cambiar de
paquete.

### La aplicación, en `sistema/app/`

**Pantalla pública por nivel:** QR que se renueva solo, marcación con PIN, vinculación de
dispositivo y geocerca.

**Panel por nivel** (`/{nivel}/admin`): panel del día, padrón con credenciales, registros con
marcación manual y corrección de movimientos, clasificación de salidas intermedias, licencias,
vacaciones, usuarios y permisos, sedes, configuración.

**Área de plataforma** (`/plataforma`): alta, suspensión y reactivación de niveles, y sus
operadores. Cuentas separadas de las de cada nivel y sin acceso a ningún panel.

---

## Las dos decisiones que atraviesan todo

**Los eventos son la única fuente de verdad.** `attendance_days` es una proyección que siempre se
recalcula con la misma función, `recomputeDay()`. En el sistema actual el cálculo de tardanza está
escrito tres veces —en el registro de entrada, en el recálculo del panel y en la marcación
manual— y una de las copias ni siquiera lee la configuración.

**Nada se borra.** Un movimiento mal cargado se anula, con autor y motivo, y deja de contar. Una
corrección guarda la hora original. El historial queda completo.

---

## El cambio conceptual, en un ejemplo

Antes, cada artículo con reglas especiales tenía su bloque escrito a mano en
`app/api/admin/leave-balance/route.ts`:

```ts
if (code === "ART8A")    detail = { withPayUsed: Math.min(used, 30), remainingWithPay: Math.max(30 - used, 0), excessWithoutPay: Math.max(used - 30, 0) };
if (code === "ART12")    detail = { withPayUsed: Math.min(used, 20), withoutPayUsed: Math.max(Math.min(used - 20, 20), 0), ... };
if (code === "ART13BIS") detail = { baseUsed: Math.min(used, 15), extensionUsed: Math.max(Math.min(used - 15, 15), 0), ... };
if (code === "ART8B" || code === "ART8C") detail = { fullPayUsed: Math.min(used, 730), halfPayUsed: Math.max(Math.min(used - 730, 365), 0), ... };
```

Los cuatro son el mismo patrón: **tramos consecutivos de cuota**, cada uno con su ventana de
cómputo, su tope, su tasa de pago y qué hacer al agotarse. Expresados como datos:

| Tipo | Tramo 1 | Tramo 2 |
|---|---|---|
| `ART8A` | ANUAL 30 d al 100 %, desborda | ANUAL sin tope al 0 % |
| `ART12` | ANUAL 20 d al 100 %, desborda | ANUAL 20 d al 0 %, bloquea |
| `ART13BIS` | EVENTO 15 d al 100 %, desborda | EVENTO 15 d al 100 %, bloquea |
| `ART8B` / `ART8C` | EVENTO 730 d al 100 %, desborda | EVENTO 365 d al 50 %, bloquea |
| `ART30B` | ANUAL 6 d al 100 %, bloquea | MENSUAL 2 d al 100 %, bloquea |

Un solo evaluador consume esas filas. Los cuatro `if` desaparecen y los topes pasan a ser
editables desde una pantalla.

Lo mismo con la tolerancia: «hasta 15 minutos no hay atraso, pero si se supera se computa todo
desde la hora prevista» es `latenessMode = FULL_FROM_SCHEDULED` con tolerancia 15. La regla
inversa, habitual en otros organismos, es `GRACE_ONLY`. Y la escala 20/25/30/35 son cuatro filas de
una tabla.

**Además, el modelo por evento ahora funciona de verdad.** En el sistema actual las ventanas por
evento (Art. 8 b/c, Art. 13 bis) se alimentan con el acumulado anual, porque `leave_records` no
identifica el hecho que origina la licencia. El esquema nuevo lo identifica, así que dos episodios
distintos del mismo artículo ya no se suman entre sí.

---

## Cómo verificar

Todo corre sin servidor y sin base de datos externa, desde `sistema/`:

```bash
npm install
npm run verify:rules      # 875 comprobaciones de equivalencia con la lógica actual
npm run demo:sqlite       # dos niveles reales, aislamiento y saldos
npm run demo:asistencia   # flujo completo de marcación
npm run demo:identidad    # autenticación, permisos y aislamiento entre niveles
npm run demo:licencias    # cómputo de días y cuotas
npm run demo:configuracion
npm run demo:gestion
npm run demo:correcciones # corrección y anulación de movimientos
npm run demo:plataforma   # alta de niveles, operadores y sedes
npm run demo:cierre       # cierre automático y reparación
npm run verify:acciones
```

`verify:rules` debe terminar en `✓ 875 comprobaciones, todas equivalentes.`

Para levantarlo y usarlo, ver [`sistema/README.md`](../sistema/README.md) y
[`DESARROLLO-LOCAL.md`](./DESARROLLO-LOCAL.md).

**Qué mirar para revisar:** `core/absence/quota.ts` y el `pack.json`, que son el cambio
conceptual; `core/attendance/service.ts`, que es el corazón del sistema; y
`core/migrations/level-schema.ts`, que es el modelo de datos completo en un archivo.

---

## Cuatro problemas del sistema actual

Encontrados durante este trabajo. **Los cuatro siguen presentes en producción**, porque el commit
que corregía los dos primeros quedó revertido junto con el resto de los cambios sobre la
aplicación existente.

### 1. La configuración se revierte sola

`ensureV13Schema()` corre en cada request y contiene:

```sql
UPDATE office_settings SET lateness_tolerance_minutes = 15 WHERE id = 1 AND lateness_tolerance_minutes <> 15;
UPDATE office_settings SET absence_count_start_date = '2026-09-12' WHERE id = 1 AND absence_count_start_date IS DISTINCT FROM '2026-09-12';
```

Si un administrador cambia la tolerancia desde la pantalla de configuración, la siguiente instancia
fría de serverless se la revierte. **Es un arreglo de dos líneas** y no depende de nada de esta
rama.

### 2. El cierre automático tiene un error de zona horaria

`lib/time.ts` arma el instante de salida teórica concatenando un literal:

```ts
return `${dateString}T${hhmm}:00-03:00`;
```

En Argentina funciona porque no hay horario de verano. En cualquier zona que lo tenga, el cierre
queda desfasado una hora durante medio año.

### 3. Hay datos personales reales versionados

`lib/seed-employees.ts` (20 KB) contiene nombres, apellidos, DNI y horarios de agentes reales.
`lib/historical-licenses.ts` (227 KB), `lib/historical-license-forms.ts` (136 KB) y
`lib/historical-confirmed-2026.ts` (9 KB) suman unos 370 KB más de datos personales.

Cualquiera con acceso al repositorio tiene el padrón completo con documentos. **Esto requiere una
decisión del dueño**, porque sacarlos de ahora en más no borra el historial de Git: para
eliminarlos del todo hay que reescribir la historia, lo que obliga a rehacer todos los clones.

### 4. La validación de sede no soporta un segundo edificio

Todo el flujo de marcación resuelve la sede como «la primera activa». Con una sola funciona por
casualidad; con dos, los agentes del segundo edificio quedarían siempre fuera del radio y el
mensaje diría «estás fuera del área», que no explica nada. En el sistema nuevo el código QR lleva
consigo de qué sede salió.

---

## Qué falta en el sistema nuevo

El módulo de administración está completo y el sistema se puede usar de punta a punta. Lo que
queda, en orden de urgencia:

| Tema | Estado |
|---|---|
| Cadena de marcación: QR público, PIN sondeable, sin límite de intentos | **Pendiente — antes de cargar datos reales** |
| Validaciones de licencias: solapamiento, choque con marcaciones, tope por hecho | Pendiente |
| Saldo previo a guardar una licencia | No funciona — la ruta responde 403 por la ruta de la cookie |
| Cambio de contraseña propio y exigencia de cambio inicial | Pendiente |
| Las salidas intermedias clasificadas no afectan ningún cálculo | Decisión de diseño pendiente |
| Versionado de la política, para que las jornadas viejas no se recalculen con reglas nuevas | Decisión de diseño pendiente |
| Reportes y exportación | Pendiente |
| Despliegue: build standalone, respaldos, cierre automático programado | Pendiente |

La revisión completa, con cada hallazgo verificado corriendo código y su reproducción paso a paso,
está en el documento de revisión del proyecto.

---

## Decisiones que necesitan al dueño del repositorio

1. **Datos personales en el historial de Git.** Sacarlos de ahora en más, o reescribir la
   historia. Lo segundo es más completo y más invasivo.
2. **Qué pasa con el sistema actual.** El nuevo no lo reemplaza automáticamente: son dos
   aplicaciones distintas en el mismo repositorio. Si el nuevo va a reemplazarlo, hace falta
   decidir cómo se migran los datos existentes; si van a convivir, hace falta decidir qué hace cada
   uno. Mientras tanto, los cuatro problemas de arriba siguen en producción.
3. **Si la regla de tolerancia debe seguir siendo la actual.** Quedó tal cual estaba
   (`FULL_FROM_SCHEDULED`, 15 minutos), pero ahora es configurable y conviene confirmar que es lo
   que corresponde normativamente.
4. **El PIN de 4 dígitos.** Hoy identifica por sí solo a la persona dentro de un espacio de 10 000
   combinaciones. Subirlo a 6, o pedir documento además del PIN, cambia cómo marca la gente todos
   los días: es una decisión de uso, no sólo técnica.
