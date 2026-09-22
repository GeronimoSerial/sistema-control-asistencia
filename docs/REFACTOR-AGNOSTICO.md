# Plan de refactor: de sistema DGE a plataforma agnóstica multi-organismo

Objetivo: convertir `sistema-control-asistencia` (hoy una aplicación hecha a medida de la
Dirección de Gestión Escolar de Corrientes) en un **núcleo genérico de control de asistencia y
ausencias**, configurable por organización, donde todo lo que hoy es ley argentina, marca
institucional o padrón real vive en un **rule pack** externo. Sobre esa base se construye
después el **módulo de administración**.

Decisiones tomadas:

- Alcance: **núcleo genérico + paquete de reglas**.
- Tenancy: **multi-tenant en una sola instancia**.
- El módulo de administración debe administrar: organismos, configuración del sistema,
  catálogos y reglas, y usuarios/roles/permisos.

---

## 1. Inventario de acoplamientos

Lo que hoy impide reutilizar el sistema en otro organismo, ordenado por gravedad.

### 1.1 El esquema es estructuralmente single-tenant

```sql
CREATE TABLE office_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- ← una sola oficina, por diseño
  office_name TEXT NOT NULL DEFAULT 'Dirección de Gestión Escolar',
  latitude ..., longitude ..., radius_meters ...,
  lateness_tolerance_minutes ..., auto_close_grace_minutes ..., qr_ttl_minutes ...
)
```

`CHECK (id = 1)` es la raíz del problema: una geocerca, un nombre, una tolerancia, un flujo de
QR para toda la base. Además `employees.dni` es `UNIQUE` global y `employees.id` es un `TEXT`
asignado a mano en el seed — dos organismos no pueden coexistir.

### 1.2 Reglas jurídicas argentinas incrustadas en el código

| Regla | Dónde vive hoy |
|---|---|
| Catálogo de 18 licencias del Estatuto Docente (Art. 8 a/b/c, 12, 13, 13 bis, 15, 16, 17, 18, 19, 30 a/b/c, Ley 5898) | `lib/migrations.ts`, array `catalog`, upserteado en cada arranque |
| Saldos especiales por tipo | `app/api/admin/leave-balance/route.ts`: `if(code==="ART8A")…`, `if(code==="ART12")…`, `if(code==="ART13BIS")…`, `if(code==="ART8B"‖"ART8C")…` con literales 30/20/40/15/30/730/1095 |
| Escala de vacaciones 20/25/30/35 días por antigüedad + proporcional 1/12 | `app/api/admin/vacation-status/route.ts`, funciones `baseDays()` y `entitlement()` |
| Tolerancia de tardanza de 15' con cómputo total al excederla | `lib/attendance.ts` `registerEntry()` (`rawLate > tolerance ? rawLate : 0`) y duplicada en `app/api/admin/records/route.ts` |
| Compensación de tardanza con permanencia posterior | `lib/attendance.ts` `registerExit()` |
| Cierre automático con salida teórica | `lib/attendance.ts` `autoCloseEligibleDays()` |
| Inicio de cómputo de inasistencias el 12/09/2026 | `UPDATE office_settings SET absence_count_start_date='2026-09-12'` en `ensureV13Schema()` |
| Categorías de ausencia | `CHECK (leave_type IN ('MEDICAL','ADMINISTRATIVE','VACATION','COMMISSION','AFFECTATION','FRANCO','OTHER'))` |

### 1.3 Identidad y permisos cerrados

`app_users.role` tiene `CHECK(role IN ('ADMIN','LICENSE_OPERATOR','ATTENDANCE_OPERATOR','CUSTOM'))`
y sólo existen dos permisos, `LICENSES` y `ATTENDANCE`. Agregar un permiso nuevo hoy requiere
tocar el enum de TypeScript (`AppPermission`), el `CHECK` de Postgres y cada `canManage*()`.
Además hay una cuenta superadministradora por variables de entorno cuya contraseña se compara
**en texto plano** (`password === expectedPassword` en `lib/auth.ts`), fuera de toda auditoría.

### 1.4 Marca, idioma y zona horaria

`Dirección de Gestión Escolar`, `Gobierno de Corrientes · Ministerio de Educación` aparecen
literalmente en `app/layout.tsx`, `app/page.tsx`, `app/admin/(protected)/layout.tsx`,
`app/admin/login/page.tsx`, `app/admin/cambiar-contrasena/page.tsx`, `app/marcar/MarkClient.tsx`
y `app/PublicQrClient.tsx`. Las cookies se llaman `dge_admin_session`, `dge_device_id`,
`dge_stable_device_v1`; hasta el CSV exportado se llama `PIN_provisorios_DGE_….csv`.

`lib/time.ts` fija `APP_TIME_ZONE = "America/Argentina/Buenos_Aires"`, formatea en `es-AR`, y
—esto es un bug latente, no sólo acoplamiento— construye timestamps concatenando el literal
`-03:00`:

```ts
export function isoForArgentinaLocal(dateString: string, hhmm: string) {
  return `${dateString}T${hhmm}:00-03:00`;   // ← se rompe en cualquier zona con DST
}
```

`autoCloseEligibleDays()` depende de esa función, así que el cierre automático quedaría
desfasado una hora medio año en casi cualquier otro destino.

### 1.5 Datos reales en el repositorio

`lib/seed-employees.ts` (20 KB) trae nombres, apellidos, DNI y horarios de agentes reales, y
`initializeDatabase()` los **upsertea forzando** los valores en cada corrida.
`lib/historical-licenses.ts` (227 KB), `lib/historical-license-forms.ts` (136 KB) y
`lib/historical-confirmed-2026.ts` (9 KB) suman ~370 KB más de datos personales versionados en
Git. Esto es a la vez un acoplamiento y un problema de protección de datos: hay que sacarlo del
código fuente, no sólo parametrizarlo.

### 1.6 Migraciones que pisan la configuración del administrador

`ensureV13Schema()` corre en cada request (con un flag `migrated` en memoria del módulo, que se
reinicia en cada cold start de serverless) y contiene:

```sql
UPDATE office_settings SET lateness_tolerance_minutes=15 WHERE id=1 AND lateness_tolerance_minutes<>15
UPDATE office_settings SET absence_count_start_date='2026-09-12' WHERE id=1 AND ...
```

Es decir: si un administrador cambia la tolerancia desde la UI, la siguiente instancia fría se
la revierte. Con multi-tenant esto pasaría de molesto a inaceptable. Hace falta un runner de
migraciones **versionado, idempotente y que no toque datos de configuración**.

---

## 2. Arquitectura objetivo

```
core/                       núcleo agnóstico — no conoce Corrientes, ni docentes, ni Argentina
  platform/                 adaptadores: db, time (con TZ por organización), crypto, geo
  tenancy/                  organizations, resolución y contexto de request
  config/                   registro de definiciones de settings + resolución con herencia
  identity/                 usuarios, roles dinámicos, permisos por recurso:acción
  people/                   sujetos (personas) y sus atributos extensibles
  attendance/               motor de jornada: eventos, secuencias, política declarativa
  absence/                  motor de ausencias: tipos, cuotas por tramos, balances
  audit/
packs/
  ar-corrientes-dge/        rule pack: branding, catálogo docente, escalas, política
app/
  (public)/                 pantalla de QR y marcación
  admin/                    módulo de administración (se construye sobre lo anterior)
```

Regla de oro: **`core/` no puede contener la cadena "Art.", ni "docente", ni "Corrientes", ni
un número mágico de días.** Todo eso es dato del pack o de la base.

### 2.1 Tenancy

```sql
CREATE TABLE organizations (
  id            UUID PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,      -- resolución por subdominio o path
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  time_zone     TEXT NOT NULL,
  locale        TEXT NOT NULL,
  rule_pack     TEXT,                      -- pack aplicado, para trazabilidad
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Todas las tablas de dominio ganan `organization_id UUID NOT NULL REFERENCES organizations(id)`.
Los índices únicos pasan a ser compuestos: `UNIQUE(organization_id, national_id)`,
`UNIQUE(organization_id, code)`, etc.

`office_settings` se parte en dos:

- `locations` — varias sedes por organismo, cada una con su geocerca y su flujo de QR.
- `setting_values` — el resto, tipado, ver 2.2.

El aislamiento se garantiza en un solo lugar: un helper `withTenant()` que envuelve toda
consulta de dominio y agrega el filtro, más `SET LOCAL app.organization_id` para poder activar
Row Level Security en Postgres más adelante sin reescribir las queries.

### 2.2 Configuración como registro tipado

En vez de columnas nuevas por cada parámetro (que es lo que hizo crecer `office_settings` de
versión en versión), un registro declarativo:

```ts
defineSetting({
  key: "attendance.lateness_tolerance_minutes",
  type: "integer",
  scope: "organization",      // organization | location | group
  default: 0,
  min: 0, max: 240,
  label: "Tolerancia de ingreso",
  help: "Minutos de gracia antes de computar tardanza.",
});
```

```sql
CREATE TABLE setting_values (
  organization_id UUID NOT NULL,
  scope_type      TEXT NOT NULL,   -- ORGANIZATION | LOCATION
  scope_id        TEXT,
  key             TEXT NOT NULL,
  value           JSONB NOT NULL,
  updated_by      TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, scope_type, scope_id, key)
);
```

Esto es lo que hace posible la pantalla "Configuración del sistema" del módulo de
administración: **el formulario se renderiza desde las definiciones**, no se programa campo por
campo. Agregar un parámetro nuevo pasa a ser una línea de `defineSetting` y aparece solo en la UI,
validado.

### 2.3 Motor de ausencias declarativo

Éste es el cambio que más código de dominio elimina. Hoy:

```ts
if(code==="ART8A")   detail={withPayUsed:Math.min(used,30), remainingWithPay:Math.max(30-used,0), excessWithoutPay:Math.max(used-30,0)};
if(code==="ART12")   detail={withPayUsed:Math.min(used,20), withoutPayUsed:..., remainingWithoutPay:Math.max(40-...)};
if(code==="ART13BIS")detail={baseUsed:Math.min(used,15), extensionUsed:..., excess:Math.max(used-30,0)};
if(code==="ART8B"||code==="ART8C") detail={fullPayUsed:Math.min(used,730), halfPayUsed:..., ...};
```

Cuatro casos especiales, con siete literales cada uno, imposibles de editar sin desplegar.
Todos son en realidad **el mismo patrón**: tramos consecutivos de cuota, cada uno con su
ventana, su límite y su tasa de pago, y un comportamiento al agotarse.

```sql
CREATE TABLE absence_types (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL,
  code TEXT NOT NULL, name TEXT NOT NULL,
  category TEXT NOT NULL,            -- catálogo por organismo, no enum de Postgres
  reference TEXT,                    -- "Art. 8 inc. a" — texto libre, el core no lo interpreta
  day_basis TEXT NOT NULL,           -- CALENDAR | BUSINESS | SCHEDULED | MANUAL
  requires_document BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (organization_id, code)
);

CREATE TABLE absence_quota_tiers (
  id UUID PRIMARY KEY,
  absence_type_id UUID NOT NULL REFERENCES absence_types(id) ON DELETE CASCADE,
  tier_order  SMALLINT NOT NULL,     -- 1, 2, 3…
  window      TEXT NOT NULL,         -- ANNUAL | MONTHLY | EVENT | ROLLING | LIFETIME
  window_days INTEGER,               -- sólo para ROLLING
  limit_days  NUMERIC(8,2),          -- NULL = sin límite
  pay_rate    NUMERIC(5,4) NOT NULL DEFAULT 1,   -- 1 = 100 %, 0.5 = 50 %, 0 = sin goce
  on_exhausted TEXT NOT NULL,        -- SPILL | WARN | BLOCK
  UNIQUE (absence_type_id, tier_order)
);
```

Los cuatro casos especiales quedan como datos:

| Tipo | Tramo 1 | Tramo 2 | Tramo 3 |
|---|---|---|---|
| `ART8A` | ANNUAL 30 d @ 100 % → SPILL | ANNUAL ∞ @ 0 % | — |
| `ART12` | ANNUAL 20 d @ 100 % → SPILL | ANNUAL 20 d @ 0 % → BLOCK | — |
| `ART13BIS` | EVENT 15 d @ 100 % → SPILL | EVENT 15 d @ 100 % → BLOCK | — |
| `ART8B` / `ART8C` | EVENT 730 d @ 100 % → SPILL | EVENT 365 d @ 50 % → BLOCK | — |
| `ART30B` | ANNUAL 6 d + MONTHLY 2 d @ 100 % → BLOCK | — | — |

Un único evaluador, `core/absence/quota.ts`, consume días usados por ventana y devuelve el
desglose por tramo. El endpoint `leave-balance` deja de tener un solo `if` por código y el
módulo de administración puede editar cuotas desde una tabla.

### 2.4 Escalas de derecho (vacaciones)

```sql
CREATE TABLE entitlement_scales (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL, code TEXT NOT NULL,
  basis TEXT NOT NULL,             -- SENIORITY_YEARS
  proration TEXT NOT NULL,         -- NONE | MONTHLY_TWELFTHS
  full_after_months SMALLINT,      -- 6 en el caso actual
  UNIQUE (organization_id, code)
);
CREATE TABLE entitlement_scale_tiers (
  scale_id UUID NOT NULL REFERENCES entitlement_scales(id) ON DELETE CASCADE,
  from_value NUMERIC NOT NULL, to_value NUMERIC, days NUMERIC(8,2) NOT NULL
);
```

`baseDays()` (20/25/30/35) se vuelve cuatro filas; el proporcional 1/12 para interinos con menos
de seis meses se vuelve `proration = MONTHLY_TWELFTHS, full_after_months = 6`.

### 2.5 Política de asistencia declarativa

```sql
CREATE TABLE attendance_policies (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
  lateness_tolerance_minutes INTEGER NOT NULL DEFAULT 0,
  lateness_mode       TEXT NOT NULL,   -- GRACE_ONLY | FULL_FROM_SCHEDULED
  early_exit_mode     TEXT NOT NULL,   -- COUNT | IGNORE
  compensation_mode   TEXT NOT NULL,   -- NONE | SAME_DAY
  auto_close_mode     TEXT NOT NULL,   -- NONE | THEORETICAL_END
  auto_close_grace_minutes INTEGER NOT NULL DEFAULT 60,
  movement_sequence   TEXT NOT NULL,   -- SIMPLE | MULTI (entrada/salida/reingreso/salida)
  counting_start_date DATE,
  UNIQUE (organization_id, code)
);
```

La regla DGE («hasta 15 minutos no hay atraso; si se supera, se computa el total desde la hora
prevista») es exactamente `lateness_mode = FULL_FROM_SCHEDULED` con tolerancia 15. La regla
habitual en la mayoría de los organismos es `GRACE_ONLY`. Hoy la primera está escrita dos veces,
en `lib/attendance.ts` y en `app/api/admin/records/route.ts`; pasa a estar en un solo lugar,
`core/attendance/policy.ts`, y a ser dato.

### 2.6 Identidad y RBAC dinámico

```sql
CREATE TABLE permissions (code TEXT PRIMARY KEY, resource TEXT, action TEXT, description TEXT);
CREATE TABLE roles (id UUID PRIMARY KEY, organization_id UUID, code TEXT, name TEXT, system BOOLEAN);
CREATE TABLE role_permissions (role_id UUID, permission_code TEXT, PRIMARY KEY (role_id, permission_code));
CREATE TABLE user_roles (user_id UUID, role_id UUID, PRIMARY KEY (user_id, role_id));
```

Permisos con forma `recurso.acción`: `attendance.read`, `attendance.mark_manual`,
`absence.write`, `people.manage`, `settings.write`, `users.manage`, `organizations.manage`.
`hasPermission(session, "absence.write")` reemplaza a `canManageLicenses()`. Se separa el
**operador de plataforma** (puede dar de alta organismos) del **administrador de organismo**
(sólo el suyo) — sin esa distinción el alta de organismos del módulo de administración no tiene
a quién autorizar. La cuenta de entorno con contraseña en texto plano se reemplaza por un
usuario real con hash, creado en el bootstrap.

---

## 3. Fases

Cada fase deja el sistema desplegable. No hay un "big bang".

| Fase | Qué entrega | Riesgo |
|---|---|---|
| **0. Red de seguridad** | Migraciones versionadas con tabla `schema_migrations`; se elimina el `UPDATE` que pisa la configuración; tests de caracterización que congelan el comportamiento actual de tardanza, compensación, cierre automático y los cuatro balances especiales | Bajo — no cambia comportamiento |
| **1. Plataforma y marca** | `core/platform` (tiempo con TZ por organización y sin `-03:00` literal), branding y textos desde configuración, cookies con nombre neutro | Bajo |
| **2. Multi-tenant** | `organizations`, `organization_id` en todo, backfill del organismo actual como primer tenant, resolución de tenant por request, unicidades compuestas | **Alto** — migración de datos |
| **3. Identidad** | Permisos `recurso.acción`, roles dinámicos, operador de plataforma, baja de la cuenta de entorno | Medio |
| **4. Motor de ausencias** | Cuotas por tramos + escalas de derecho; `leave-balance` y `vacation-status` sin literales | Medio — validar contra los tests de la fase 0 |
| **5. Motor de asistencia** | Política declarativa; se unifica la regla duplicada | Medio |
| **6. Rule pack** | `packs/ar-corrientes-dge/` con branding, catálogo, escalas y política; importador de padrón; **se saca del repo `seed-employees.ts` y los ~370 KB de datos históricos** | Medio |
| **7. Módulo de administración** | Organismos, configuración (formularios generados desde las definiciones), catálogos y cuotas, usuarios/roles/permisos | — |

Orden obligado: 2 antes que 4 y 5 (las reglas cuelgan del tenant); 3 antes que 7 (el módulo
necesita a quién autorizar); 6 antes de ofrecer el sistema a un segundo organismo.

---

## 4. Lo que no hay que perder de vista

- **Los datos históricos de 2026 son de personas reales.** Sacarlos del repositorio es parte del
  refactor, no una tarea aparte. Mientras estén en Git, cualquiera con acceso al repo tiene el
  padrón completo con DNI.
- **`isoForArgentinaLocal` es un bug, no sólo un acoplamiento.** Al hacerlo agnóstico hay que
  calcular el offset real de la zona para esa fecha, no concatenar una constante.
- **La fase 2 es la única con riesgo de pérdida de datos.** Backup verificado y migración
  ensayada sobre una copia antes de tocar producción.
- **`ensureV13Schema()` corriendo en cada request** ya es un costo por llamada; al migrarlo a un
  runner versionado se gana latencia además de corrección.
