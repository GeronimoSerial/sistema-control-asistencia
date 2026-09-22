/**
 * Esquema de la base de un nivel.
 *
 * Cada nivel —Primaria, Secundaria— tiene su propio archivo con este esquema. Por eso **ninguna
 * tabla lleva `organization_id`**: el archivo ya delimita a quién pertenecen los datos. Es lo que
 * hace desaparecer la migración multi-inquilino que era la parte riesgosa del plan original.
 *
 * Convenciones, porque SQLite no tiene tipos de fecha ni booleanos:
 * - instantes: texto ISO-8601 en UTC;
 * - fechas civiles: `YYYY-MM-DD`;
 * - booleanos: enteros 0 y 1;
 * - identificadores de entidad: texto (UUID generado por la aplicación);
 * - secuencias de eventos y bitácoras: `INTEGER PRIMARY KEY AUTOINCREMENT`.
 */

export const LEVEL_SCHEMA_ID = "0001_level_base";

export const LEVEL_SCHEMA_SQL = /* sql */ `

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------- Configuración

CREATE TABLE IF NOT EXISTS settings (
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('LEVEL','LOCATION')),
  scope_id    TEXT NOT NULL DEFAULT '',
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,              -- JSON
  updated_by  TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id, key)
);

CREATE TABLE IF NOT EXISTS locations (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  latitude   REAL,
  longitude  REAL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------- Personas

CREATE TABLE IF NOT EXISTS people (
  id             TEXT PRIMARY KEY,
  last_name      TEXT NOT NULL,
  first_name     TEXT NOT NULL,
  national_id    TEXT NOT NULL UNIQUE,    -- DNI, CI, RUT… la etiqueta es configurable
  employment     TEXT,
  seniority_date TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS person_schedules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,               -- HH:MM
  end_time   TEXT NOT NULL,
  UNIQUE (person_id, weekday)
);

CREATE TABLE IF NOT EXISTS credentials (
  person_id    TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  pin_hash     TEXT,
  pin_lookup   TEXT UNIQUE,
  force_change INTEGER NOT NULL DEFAULT 0,
  changed_at   TEXT,
  change_source TEXT,
  reset_count  INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  device_hash   TEXT NOT NULL UNIQUE,
  family_hash   TEXT,
  recovery_hash TEXT,
  user_agent    TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  revoked_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_one_active
  ON devices(person_id) WHERE active = 1;

-- ---------------------------------------------------------------- Asistencia

CREATE TABLE IF NOT EXISTS attendance_policies (
  id                         TEXT PRIMARY KEY,
  code                       TEXT NOT NULL UNIQUE,
  name                       TEXT NOT NULL,
  lateness_tolerance_minutes INTEGER NOT NULL DEFAULT 0,
  lateness_mode              TEXT NOT NULL DEFAULT 'GRACE_ONLY'
                             CHECK (lateness_mode IN ('GRACE_ONLY','FULL_FROM_SCHEDULED')),
  count_early_exit           INTEGER NOT NULL DEFAULT 1,
  compensation_mode          TEXT NOT NULL DEFAULT 'NONE'
                             CHECK (compensation_mode IN ('NONE','SAME_DAY')),
  auto_close_mode            TEXT NOT NULL DEFAULT 'NONE'
                             CHECK (auto_close_mode IN ('NONE','THEORETICAL_END')),
  auto_close_grace_minutes   INTEGER NOT NULL DEFAULT 60,
  movement_sequence          TEXT NOT NULL DEFAULT 'SIMPLE'
                             CHECK (movement_sequence IN ('SIMPLE','MULTI')),
  counting_start_date        TEXT,
  is_default                 INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_default
  ON attendance_policies(is_default) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS attendance_days (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id              TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  work_date              TEXT NOT NULL,
  scheduled_start        TEXT NOT NULL,
  scheduled_end          TEXT NOT NULL,
  entry_at               TEXT,
  exit_at                TEXT,
  entry_latitude         REAL,
  entry_longitude        REAL,
  entry_accuracy         REAL,
  entry_distance_meters  REAL,
  exit_latitude          REAL,
  exit_longitude         REAL,
  exit_accuracy          REAL,
  exit_distance_meters   REAL,
  late_minutes           INTEGER NOT NULL DEFAULT 0,
  early_minutes          INTEGER NOT NULL DEFAULT 0,
  compensation_minutes   INTEGER NOT NULL DEFAULT 0,
  pending_minutes        INTEGER NOT NULL DEFAULT 0,
  exit_type              TEXT CHECK (exit_type IN ('EMPLOYEE','AUTO','ADMIN')),
  auto_close_processed_at TEXT,
  admin_note             TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE (person_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_days_date ON attendance_days(work_date);

-- Las siete últimas columnas son la corrección administrativa: un movimiento mal cargado no se
-- borra, se anula, y la fila queda con quién lo hizo y por qué. original_occurred_at guarda la
-- hora con la que se marcó originalmente y sólo se escribe en la primera corrección, para que no
-- se pierda detrás de una segunda.
--
-- Los comentarios van acá afuera y no entre las columnas a propósito: ALTER TABLE reescribe el
-- texto del CREATE guardado en el esquema, y un comentario de línea en el medio lo deja cortado.
CREATE TABLE IF NOT EXISTS attendance_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_day_id INTEGER REFERENCES attendance_days(id) ON DELETE SET NULL,
  person_id         TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL
                    CHECK (event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT','ADMIN_EDIT','REJECTED')),
  occurred_at       TEXT NOT NULL,
  latitude          REAL,
  longitude         REAL,
  accuracy          REAL,
  distance_meters   REAL,
  metadata          TEXT,
  voided_at            TEXT,
  voided_by            TEXT,
  void_reason          TEXT,
  original_occurred_at TEXT,
  corrected_by         TEXT,
  corrected_at         TEXT,
  correction_reason    TEXT
);
CREATE INDEX IF NOT EXISTS idx_attendance_events_day ON attendance_events(attendance_day_id, occurred_at);

-- voided_at: un intervalo existe porque existe la salida que lo abrió. Si esa salida se anula, el
-- intervalo deja de describir algo ocurrido y se anula con ella.
CREATE TABLE IF NOT EXISTS attendance_intervals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_day_id INTEGER NOT NULL REFERENCES attendance_days(id) ON DELETE CASCADE,
  person_id         TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  exit_event_id     INTEGER REFERENCES attendance_events(id) ON DELETE SET NULL,
  reentry_event_id  INTEGER REFERENCES attendance_events(id) ON DELETE SET NULL,
  exited_at         TEXT NOT NULL,
  reentered_at      TEXT,
  reason_code       TEXT,
  admin_note        TEXT,
  counts_as_work    INTEGER,
  classified_by     TEXT,
  classified_at     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  voided_at         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intervals_open
  ON attendance_intervals(attendance_day_id) WHERE reentered_at IS NULL AND voided_at IS NULL;

CREATE TABLE IF NOT EXISTS qr_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT REFERENCES locations(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qr_expires ON qr_tokens(expires_at);

-- ---------------------------------------------------------------- Ausencias

CREATE TABLE IF NOT EXISTS absence_categories (
  id   TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS absence_types (
  id                TEXT PRIMARY KEY,
  category_id       TEXT REFERENCES absence_categories(id) ON DELETE SET NULL,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  reference         TEXT,
  day_basis         TEXT NOT NULL DEFAULT 'CALENDAR'
                    CHECK (day_basis IN ('CALENDAR','BUSINESS','SCHEDULED','MANUAL')),
  requires_document INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS absence_quota_tiers (
  id              TEXT PRIMARY KEY,
  absence_type_id TEXT NOT NULL REFERENCES absence_types(id) ON DELETE CASCADE,
  tier_order      INTEGER NOT NULL,
  label           TEXT,
  window_type     TEXT NOT NULL
                  CHECK (window_type IN ('ANNUAL','MONTHLY','EVENT','ROLLING','LIFETIME')),
  window_days     INTEGER,
  limit_days      REAL,
  pay_rate        REAL NOT NULL DEFAULT 1 CHECK (pay_rate BETWEEN 0 AND 1),
  on_exhausted    TEXT NOT NULL DEFAULT 'BLOCK'
                  CHECK (on_exhausted IN ('SPILL','WARN','BLOCK')),
  UNIQUE (absence_type_id, tier_order)
);

CREATE TABLE IF NOT EXISTS absence_records (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  absence_type_id TEXT NOT NULL REFERENCES absence_types(id),
  -- Identifica el hecho que origina la ausencia: un embarazo, un accidente, un duelo.
  -- El sistema anterior no lo tenía, y por eso los topes "por evento" se calculaban contra el
  -- acumulado anual. Con esto, la ventana EVENT se computa como corresponde.
  event_key       TEXT,
  date_from       TEXT NOT NULL,
  date_to         TEXT NOT NULL,
  computed_days   REAL NOT NULL DEFAULT 0,
  observation     TEXT,
  warning_text    TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS idx_absence_records_person ON absence_records(person_id, date_from);
CREATE INDEX IF NOT EXISTS idx_absence_records_event ON absence_records(absence_type_id, event_key);

-- ---------------------------------------------------------------- Escalas de derecho

CREATE TABLE IF NOT EXISTS entitlement_scales (
  id                       TEXT PRIMARY KEY,
  code                     TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  basis                    TEXT NOT NULL DEFAULT 'SENIORITY_YEARS'
                           CHECK (basis IN ('SENIORITY_YEARS','SERVICE_MONTHS')),
  proration                TEXT NOT NULL DEFAULT 'NONE'
                           CHECK (proration IN ('NONE','MONTHLY_TWELFTHS')),
  full_after_months        INTEGER,
  extra_fraction_over_days INTEGER
);

CREATE TABLE IF NOT EXISTS entitlement_scale_tiers (
  id         TEXT PRIMARY KEY,
  scale_id   TEXT NOT NULL REFERENCES entitlement_scales(id) ON DELETE CASCADE,
  from_value REAL NOT NULL,
  to_value   REAL,
  days       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlements (
  id               TEXT PRIMARY KEY,
  person_id        TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  scale_code       TEXT NOT NULL,
  benefit_year     INTEGER NOT NULL,
  basis_value      REAL NOT NULL DEFAULT 0,
  service_months   INTEGER NOT NULL DEFAULT 12,
  extra_fraction   INTEGER NOT NULL DEFAULT 0,
  entitlement_days REAL NOT NULL,
  notes            TEXT,
  updated_by       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (person_id, scale_code, benefit_year)
);

-- ---------------------------------------------------------------- Identidad

CREATE TABLE IF NOT EXISTS permissions (
  code        TEXT PRIMARY KEY,
  resource    TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  system      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  name                 TEXT,
  active               INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at        TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by TEXT,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

-- ---------------------------------------------------------------- Auditoría

CREATE TABLE IF NOT EXISTS audit_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor          TEXT NOT NULL,
  action         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  previous_value TEXT,
  new_value      TEXT,
  reason         TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

/**
 * Columnas agregadas después de que hubiera bases en uso.
 *
 * `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya existe, así que una columna nueva no
 * llega sola a las bases creadas antes. Se agregan acá, comparando contra `PRAGMA table_info`:
 * agregar una columna es barato y no reescribe la tabla, así que puede correr en cada arranque.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: "attendance_events", column: "voided_at", definition: "TEXT" },
  { table: "attendance_events", column: "voided_by", definition: "TEXT" },
  { table: "attendance_events", column: "void_reason", definition: "TEXT" },
  { table: "attendance_events", column: "original_occurred_at", definition: "TEXT" },
  { table: "attendance_events", column: "corrected_by", definition: "TEXT" },
  { table: "attendance_events", column: "corrected_at", definition: "TEXT" },
  { table: "attendance_events", column: "correction_reason", definition: "TEXT" },
  { table: "attendance_intervals", column: "voided_at", definition: "TEXT" },
];

function applyAddedColumns(db: import("node:sqlite").DatabaseSync): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
    if (columns.some((existing) => existing.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // El índice de intervalo abierto se creó sin contemplar los anulados: en una base vieja sigue
  // con el predicado anterior y rechazaría reabrir un intervalo. Se rehace con el predicado
  // completo; recrearlo es inmediato sobre tablas de este tamaño.
  db.exec(`
    DROP INDEX IF EXISTS idx_intervals_open;
    CREATE UNIQUE INDEX idx_intervals_open
      ON attendance_intervals(attendance_day_id) WHERE reentered_at IS NULL AND voided_at IS NULL;
  `);
}

/**
 * Aplica el esquema a la base de un nivel y siembra el catálogo de permisos.
 * Idempotente: se puede volver a ejecutar sin efecto.
 */
export function initLevel(db: import("node:sqlite").DatabaseSync): void {
  db.exec(LEVEL_SCHEMA_SQL);
  applyAddedColumns(db);

  const insertPermission = db.prepare(
    `INSERT INTO permissions (code, resource, action, description) VALUES (?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       resource = excluded.resource, action = excluded.action, description = excluded.description`
  );
  for (const permission of CORE_PERMISSIONS) {
    insertPermission.run(permission.code, permission.resource, permission.action, permission.description);
  }

  db.prepare(
    `INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(LEVEL_SCHEMA_ID, "Esquema base del nivel", new Date().toISOString());
}

/** Permisos del núcleo. Un nivel nuevo arranca con este catálogo. */
export const CORE_PERMISSIONS: { code: string; resource: string; action: string; description: string }[] = [
  { code: "attendance.read", resource: "attendance", action: "read", description: "Consultar registros de asistencia" },
  { code: "attendance.write", resource: "attendance", action: "write", description: "Corregir y clasificar registros" },
  { code: "attendance.mark_manual", resource: "attendance", action: "mark_manual", description: "Registrar marcaciones manuales excepcionales" },
  { code: "absence.read", resource: "absence", action: "read", description: "Consultar ausencias y saldos" },
  { code: "absence.write", resource: "absence", action: "write", description: "Registrar y anular ausencias" },
  { code: "people.read", resource: "people", action: "read", description: "Consultar el padrón" },
  { code: "people.manage", resource: "people", action: "manage", description: "Alta, baja y modificación de personas" },
  { code: "people.credentials", resource: "people", action: "credentials", description: "Gestionar PIN y dispositivos" },
  { code: "settings.read", resource: "settings", action: "read", description: "Ver la configuración del nivel" },
  { code: "settings.write", resource: "settings", action: "write", description: "Modificar la configuración del nivel" },
  { code: "rules.manage", resource: "rules", action: "manage", description: "Editar catálogos, cuotas y políticas" },
  { code: "users.manage", resource: "users", action: "manage", description: "Administrar usuarios y roles del nivel" },
  { code: "audit.read", resource: "audit", action: "read", description: "Consultar la auditoría" },
];
