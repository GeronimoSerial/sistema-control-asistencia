# Estado de la rama `refactor/agnostic-core`

Documento de lectura para quien revise esta rama. Explica qué se está haciendo, qué garantías
tiene, cómo verificarlo y qué decisiones quedan pendientes.

El plan completo está en [`REFACTOR-AGNOSTICO.md`](./REFACTOR-AGNOSTICO.md). Este documento es
el resumen operativo: qué hay hoy en la rama y qué mirar para revisarla.

---

## Por qué

El sistema funciona, pero está construido a medida de un organismo: las reglas del Estatuto del
Docente de Corrientes, la escala de vacaciones, la tolerancia de ingreso y la zona horaria están
escritas como código, no guardadas como datos. Cambiar un tope de días implica editar un archivo,
compilar y desplegar. Y la base de datos tiene, literalmente, una restricción que impide que
exista más de una oficina:

```sql
CREATE TABLE office_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ...
)
```

El objetivo es separar **el motor** de **las reglas**, para poder después construir un módulo de
administración que gestione organismos, configuración, catálogos y permisos sin tocar el
repositorio.

---

## Garantías de esta rama

Lo más importante para revisarla con tranquilidad:

1. **No cambia el comportamiento de la aplicación.** Todo camino nuevo tiene respaldo al anterior.
   Si se despliega esta rama sin correr la instalación, el sistema responde exactamente igual que
   hoy.
2. **No modifica ninguna tabla existente.** La migración `0001` sólo crea tablas nuevas. No hay
   `ALTER` ni `UPDATE` sobre `employees`, `attendance_days`, `leave_records` ni ninguna otra.
3. **Es reversible.** Revertir los commits deja el sistema como estaba. Las tablas nuevas quedan
   huérfanas pero no molestan a nada.
4. **Los cálculos están verificados.** Hay un script que reimplementa la lógica anterior tal cual
   y compara resultados: 875 comprobaciones, todas equivalentes.

Para saber qué motor respondió en cada request, las respuestas de `leave-balance` y
`vacation-status` traen un campo `source`: `"LEGACY"` (lógica anterior) o `"RULES"` (motor
declarativo).

---

## Qué hay, commit por commit

### 1. `refactor: núcleo agnóstico, tenancy y reglas declarativas (fases 0-1)`

Construye el motor. No toca código existente: sólo agrega carpetas nuevas.

- `core/platform/time.ts` — tiempo con zona horaria explícita.
- `core/config/` — registro tipado de parámetros, con ámbito, valor por defecto y validación.
- `core/tenancy/` — organizaciones y contexto por request.
- `core/absence/quota.ts` — evaluador de cuotas por tramos.
- `core/absence/entitlement.ts` — escalas de derecho por antigüedad.
- `core/attendance/policy.ts` — política de asistencia declarativa.
- `core/migrations/` — runner versionado con tabla `schema_migrations`.
- `packs/ar-corrientes-dge/pack.json` — marca, catálogo del Estatuto Docente con sus cuotas,
  escala de vacaciones, política y roles, como datos.
- `scripts/verify-rules.ts` — la verificación de equivalencia.

**Qué mirar:** `core/absence/quota.ts` y el `pack.json`. Ahí se ve el cambio conceptual.

### 2. `feat: conectar el núcleo agnóstico en modo un organismo`

Enchufa el motor. Es donde está el cambio funcional.

- `app/api/platform/install/route.ts` — endpoint protegido con `SETUP_TOKEN` que corre las
  migraciones, da de alta el organismo y aplica el pack. Idempotente.
- `app/api/admin/leave-balance/route.ts` — reescrito.
- `app/api/admin/vacation-status/route.ts` — reescrito.
- `lib/attendance.ts` y `app/api/admin/records/route.ts` — usan la política.
- `lib/migrations.ts` — se quitan dos `UPDATE`.

**Qué mirar:** el diff de `leave-balance`, y el del `lib/migrations.ts`, que corrige un problema
real descrito más abajo.

### 3. `chore: agregar .gitignore y guía de desarrollo local`

El repositorio no tenía `.gitignore`. Se agrega uno, se deja de versionar
`tsconfig.tsbuildinfo` (artefacto de compilación) y se suma `docs/DESARROLLO-LOCAL.md`.

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
desde la hora prevista» es ahora `latenessMode = FULL_FROM_SCHEDULED` con tolerancia 15. La regla
inversa, que es la habitual en otros organismos, es `GRACE_ONLY`. Y la escala 20/25/30/35 son
cuatro filas de una tabla.

---

## Tres problemas encontrados en el camino

Son independientes del refactor y conviene mirarlos aparte.

### 1. La configuración se revierte sola

`ensureV13Schema()` corre en cada request y contenía:

```sql
UPDATE office_settings SET lateness_tolerance_minutes = 15 WHERE id = 1 AND lateness_tolerance_minutes <> 15;
UPDATE office_settings SET absence_count_start_date = '2026-09-12' WHERE id = 1 AND absence_count_start_date IS DISTINCT FROM '2026-09-12';
```

Si un administrador cambia la tolerancia desde la pantalla de configuración, la siguiente
instancia fría de serverless se la revierte. El commit 2 quita ambas sentencias: la tolerancia
pasó a ser parte de la política del organismo, y la fecha de cómputo sólo se establece si nunca
se fijó.

### 2. El cierre automático tiene un error de zona horaria

`lib/time.ts` arma el instante de salida teórica concatenando un literal:

```ts
return `${dateString}T${hhmm}:00-03:00`;
```

En Argentina funciona porque no hay horario de verano. En cualquier zona que lo tenga, el cierre
automático queda desfasado una hora durante medio año. `core/platform/time.ts` calcula el offset
real para esa fecha.

### 3. Hay datos personales reales versionados

`lib/seed-employees.ts` (20 KB) contiene nombres, apellidos, DNI y horarios de agentes reales.
`lib/historical-licenses.ts` (227 KB), `lib/historical-license-forms.ts` (136 KB) y
`lib/historical-confirmed-2026.ts` (9 KB) suman unos 370 KB más de datos personales.

Cualquiera con acceso al repositorio tiene el padrón completo con documentos. **Esto requiere una
decisión del dueño**, porque sacarlos de ahora en más no borra el historial de Git: si se quiere
eliminarlos del todo hay que reescribir la historia del repositorio, lo que obliga a que todos
los clones se rehagan.

---

## Cómo verificar

Sin base de datos, la equivalencia de los cálculos:

```
npm run verify:rules
```

Debe terminar en `✓ 875 comprobaciones, todas equivalentes.`

Con una base de prueba, el sistema completo: ver [`DESARROLLO-LOCAL.md`](./DESARROLLO-LOCAL.md).

Para activar el motor nuevo en un entorno ya desplegado:

1. Definir `SETUP_TOKEN` (cadena larga y aleatoria) en las variables de entorno.
2. `POST /api/platform/install` con la cabecera `x-setup-token`.
3. Definir `DEFAULT_ORGANIZATION_SLUG` con el slug devuelto y redesplegar.
4. Comprobar que `leave-balance` empieza a responder `source: "RULES"` y que los números
   coinciden con los anteriores.

Si algo no cierra, basta con quitar `DEFAULT_ORGANIZATION_SLUG`: el sistema vuelve a
`source: "LEGACY"` sin desplegar nada.

---

## Qué falta

| Fase | Estado |
|---|---|
| 0. Migraciones versionadas y verificación | Hecho |
| 1. Plataforma y tiempo agnóstico | Hecho |
| 1.5 Motor conectado en un solo organismo | Hecho |
| Marca y textos desde configuración | Pendiente — toca siete pantallas, es mecánico |
| 2. Multi-tenant (`organization_id` y backfill) | **Pendiente — única fase con riesgo de pérdida de datos** |
| 3. Permisos granulares y roles dinámicos | Modelado, sin conectar |
| 4-5. Reglas y política desde la administración | Modelado, sin conectar |
| 6. Padrón y datos históricos fuera del repositorio | Pendiente — requiere decisión |
| 7. Módulo de administración | Pendiente |

### Limitación conocida

Las ventanas por evento (Art. 8 b/c, Art. 13 bis) se alimentan hoy con el acumulado anual, porque
`leave_records` no identifica el hecho que origina la licencia. Es exactamente lo que hacía el
sistema antes, así que no hay cambio de comportamiento, pero el modelo ya soporta el cómputo por
evento: cuando los registros tengan un identificador de evento, sólo cambia el objeto de consumo
que se le pasa al evaluador.

---

## Decisiones que necesitan al dueño del repositorio

1. **Datos personales en el historial de Git.** Sacarlos de ahora en más, o reescribir la
   historia. Lo segundo es más completo y más invasivo.
2. **Cuándo encarar la fase 2.** Es la que agrega `organization_id` a las tablas de dominio y
   migra los datos existentes. Necesita respaldo verificado y ensayo sobre una copia.
3. **Si la regla de tolerancia debe seguir siendo la actual.** Hoy quedó tal cual estaba
   (`FULL_FROM_SCHEDULED`, 15 minutos), pero ahora es configurable y conviene confirmar que es lo
   que corresponde normativamente.
