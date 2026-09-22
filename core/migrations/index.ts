/**
 * Catálogo de migraciones del núcleo.
 *
 * `0001` introduce la infraestructura agnóstica **sin tocar** las tablas existentes: convive con
 * el esquema actual mientras dura la migración. El backfill del organismo actual y el agregado
 * de `organization_id` a las tablas de dominio corresponden a la fase 2 y van en `0002`, que se
 * escribe con la base de producción respaldada y la migración ensayada sobre una copia.
 */

import type { Migration } from "@/core/migrations/runner";

const createTenancyAndRules: Migration = {
  id: "0001_tenancy_settings_rules",
  name: "Organizaciones, configuración tipada, permisos y reglas declarativas",
  async up(client) {
    await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

    /* -------- Organizaciones y sedes -------- */

    await client`
      CREATE TABLE IF NOT EXISTS organizations (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug        TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
        time_zone   TEXT NOT NULL DEFAULT 'UTC',
        locale      TEXT NOT NULL DEFAULT 'es',
        rule_pack   TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS locations (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code            TEXT NOT NULL,
        name            TEXT NOT NULL,
        latitude        DOUBLE PRECISION,
        longitude       DOUBLE PRECISION,
        active          BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (organization_id, code)
      )
    `;

    /* -------- Configuración tipada -------- */

    // `scope_id` usa cadena vacía en lugar de NULL para que la clave primaria funcione:
    // en Postgres dos NULL no colisionan y se duplicarían las filas de ámbito organización.
    await client`
      CREATE TABLE IF NOT EXISTS setting_values (
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        scope_type      TEXT NOT NULL CHECK (scope_type IN ('ORGANIZATION','LOCATION')),
        scope_id        TEXT NOT NULL DEFAULT '',
        key             TEXT NOT NULL,
        value           JSONB NOT NULL,
        updated_by      TEXT,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (organization_id, scope_type, scope_id, key)
      )
    `;

    /* -------- Identidad: permisos y roles dinámicos -------- */

    await client`
      CREATE TABLE IF NOT EXISTS permissions (
        code        TEXT PRIMARY KEY,
        resource    TEXT NOT NULL,
        action      TEXT NOT NULL,
        description TEXT,
        platform    BOOLEAN NOT NULL DEFAULT FALSE
      )
    `;

    await client`
      INSERT INTO permissions (code, resource, action, description, platform) VALUES
        ('attendance.read',        'attendance',    'read',        'Consultar registros de asistencia', FALSE),
        ('attendance.write',       'attendance',    'write',       'Corregir y clasificar registros', FALSE),
        ('attendance.mark_manual', 'attendance',    'mark_manual', 'Registrar marcaciones manuales excepcionales', FALSE),
        ('absence.read',           'absence',       'read',        'Consultar ausencias y saldos', FALSE),
        ('absence.write',          'absence',       'write',       'Registrar y anular ausencias', FALSE),
        ('people.read',            'people',        'read',        'Consultar el padrón', FALSE),
        ('people.manage',          'people',        'manage',      'Alta, baja y modificación de personas', FALSE),
        ('people.credentials',     'people',        'credentials', 'Gestionar PIN y dispositivos', FALSE),
        ('settings.read',          'settings',      'read',        'Ver la configuración del organismo', FALSE),
        ('settings.write',         'settings',      'write',       'Modificar la configuración del organismo', FALSE),
        ('rules.manage',           'rules',         'manage',      'Editar catálogos, cuotas y políticas', FALSE),
        ('users.manage',           'users',         'manage',      'Administrar usuarios y roles del organismo', FALSE),
        ('audit.read',             'audit',         'read',        'Consultar la auditoría', FALSE),
        ('organizations.manage',   'organizations', 'manage',      'Alta y administración de organismos', TRUE)
      ON CONFLICT (code) DO UPDATE
        SET resource = EXCLUDED.resource, action = EXCLUDED.action,
            description = EXCLUDED.description, platform = EXCLUDED.platform
    `;

    await client`
      CREATE TABLE IF NOT EXISTS roles (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        code            TEXT NOT NULL,
        name            TEXT NOT NULL,
        description     TEXT,
        system          BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    // Un rol de plataforma tiene organization_id NULL; el índice parcial cubre ambos casos.
    await client`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_org_code
        ON roles (organization_id, code) WHERE organization_id IS NOT NULL
    `;
    await client`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_platform_code
        ON roles (code) WHERE organization_id IS NULL
    `;

    await client`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_code)
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id    BIGINT NOT NULL,
        role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        granted_by TEXT,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, role_id)
      )
    `;

    /* -------- Reglas declarativas de ausencias -------- */

    await client`
      CREATE TABLE IF NOT EXISTS absence_categories (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code            TEXT NOT NULL,
        name            TEXT NOT NULL,
        UNIQUE (organization_id, code)
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS absence_types (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        category_id       UUID REFERENCES absence_categories(id) ON DELETE SET NULL,
        code              TEXT NOT NULL,
        name              TEXT NOT NULL,
        reference         TEXT,
        day_basis         TEXT NOT NULL DEFAULT 'CALENDAR'
                          CHECK (day_basis IN ('CALENDAR','BUSINESS','SCHEDULED','MANUAL')),
        requires_document BOOLEAN NOT NULL DEFAULT FALSE,
        notes             TEXT,
        active            BOOLEAN NOT NULL DEFAULT TRUE,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (organization_id, code)
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS absence_quota_tiers (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        absence_type_id UUID NOT NULL REFERENCES absence_types(id) ON DELETE CASCADE,
        tier_order      SMALLINT NOT NULL,
        label           TEXT,
        -- 'window' es palabra reservada en PostgreSQL: la columna se llama window_type.
        window_type     TEXT NOT NULL
                        CHECK (window_type IN ('ANNUAL','MONTHLY','EVENT','ROLLING','LIFETIME')),
        window_days     INTEGER,
        limit_days      NUMERIC(8,2),
        pay_rate        NUMERIC(5,4) NOT NULL DEFAULT 1 CHECK (pay_rate BETWEEN 0 AND 1),
        on_exhausted    TEXT NOT NULL DEFAULT 'BLOCK'
                        CHECK (on_exhausted IN ('SPILL','WARN','BLOCK')),
        UNIQUE (absence_type_id, tier_order)
      )
    `;

    /* -------- Escalas de derecho -------- */

    await client`
      CREATE TABLE IF NOT EXISTS entitlement_scales (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code                     TEXT NOT NULL,
        name                     TEXT NOT NULL,
        basis                    TEXT NOT NULL DEFAULT 'SENIORITY_YEARS'
                                 CHECK (basis IN ('SENIORITY_YEARS','SERVICE_MONTHS')),
        proration                TEXT NOT NULL DEFAULT 'NONE'
                                 CHECK (proration IN ('NONE','MONTHLY_TWELFTHS')),
        full_after_months        SMALLINT,
        extra_fraction_over_days SMALLINT,
        UNIQUE (organization_id, code)
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS entitlement_scale_tiers (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scale_id   UUID NOT NULL REFERENCES entitlement_scales(id) ON DELETE CASCADE,
        from_value NUMERIC NOT NULL,
        to_value   NUMERIC,
        days       NUMERIC(8,2) NOT NULL
      )
    `;

    /* -------- Política de asistencia -------- */

    await client`
      CREATE TABLE IF NOT EXISTS attendance_policies (
        id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code                       TEXT NOT NULL,
        name                       TEXT NOT NULL,
        lateness_tolerance_minutes INTEGER NOT NULL DEFAULT 0,
        lateness_mode              TEXT NOT NULL DEFAULT 'GRACE_ONLY'
                                   CHECK (lateness_mode IN ('GRACE_ONLY','FULL_FROM_SCHEDULED')),
        count_early_exit           BOOLEAN NOT NULL DEFAULT TRUE,
        compensation_mode          TEXT NOT NULL DEFAULT 'NONE'
                                   CHECK (compensation_mode IN ('NONE','SAME_DAY')),
        auto_close_mode            TEXT NOT NULL DEFAULT 'NONE'
                                   CHECK (auto_close_mode IN ('NONE','THEORETICAL_END')),
        auto_close_grace_minutes   INTEGER NOT NULL DEFAULT 60,
        movement_sequence          TEXT NOT NULL DEFAULT 'SIMPLE'
                                   CHECK (movement_sequence IN ('SIMPLE','MULTI')),
        counting_start_date        DATE,
        is_default                 BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE (organization_id, code)
      )
    `;
    await client`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_policy_default
        ON attendance_policies (organization_id) WHERE is_default
    `;
  },
};

export const migrations: Migration[] = [createTenancyAndRules];
