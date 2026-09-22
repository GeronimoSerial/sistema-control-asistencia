import { db } from "@/lib/db";
let migrated=false;

const catalog = [
  {code:"ART8A",name:"Afecciones comunes",article:"Art. 8 inc. a",category:"MEDICAL",basis:"CALENDAR",annual:30,monthly:null,event:null,extension:null,pay:"100% hasta 30 días/año; exceso sin goce",notes:"Continuos o discontinuos por año calendario. Sin antigüedad mínima."},
  {code:"ART8B",name:"Afecciones de largo tratamiento",article:"Art. 8 inc. b",category:"MEDICAL",basis:"CALENDAR",annual:null,monthly:null,event:1095,extension:null,pay:"Hasta 2 años 100% + 1 año al 50%",notes:"Tras agotar 3 años, nueva licencia de este carácter luego de 3 años de servicios."},
  {code:"ART8C",name:"Accidente de trabajo o enfermedad ocupacional",article:"Art. 8 inc. c",category:"MEDICAL",basis:"CALENDAR",annual:null,monthly:null,event:1095,extension:null,pay:"Hasta 2 años 100% + 1 año al 50%",notes:"Sin antigüedad mínima."},
  {code:"ART12",name:"Atención de miembro del grupo familiar enfermo",article:"Art. 12",category:"MEDICAL",basis:"CALENDAR",annual:40,monthly:null,event:null,extension:20,pay:"20 días 100% + hasta 20 días sin goce",notes:"Familiar conviviente a exclusivo cuidado o padre/hijo directo."},
  {code:"ART13",name:"Maternidad",article:"Art. 13 inc. a y f",category:"MEDICAL",basis:"CALENDAR",annual:null,monthly:null,event:180,extension:null,pay:"100% con 10 meses de servicios docentes; de lo contrario sin goce",notes:"Duración general 180 días corridos. Casos especiales se registran según corresponda."},
  {code:"LEY5898",name:"Atención de hijo recién nacido por fallecimiento de la madre",article:"Ley 5898 - Art. 1",category:"MEDICAL",basis:"CALENDAR",annual:null,monthly:null,event:null,extension:null,pay:"100%",notes:"Período equivalente al de maternidad que correspondía a la madre."},
  {code:"ART13BIS",name:"Violencia de género",article:"Art. 13 bis",category:"MEDICAL",basis:"CALENDAR",annual:30,monthly:null,event:15,extension:15,pay:"100%",notes:"Hasta 15 días corridos, continuos o discontinuos, prorrogables por otro período idéntico."},
  {code:"ART15",name:"Matrimonio",article:"Art. 15",category:"ADMINISTRATIVE",basis:"CALENDAR",annual:null,monthly:null,event:15,extension:null,pay:"100%",notes:"15 días corridos."},
  {code:"ART16_7",name:"Duelo - familiar directo",article:"Art. 16",category:"ADMINISTRATIVE",basis:"CALENDAR",annual:null,monthly:null,event:7,extension:null,pay:"100%",notes:"Madre, padre, cónyuge, hijo, hermano, padrastro, madrastra, hermanastros o hijastros."},
  {code:"ART16_3",name:"Duelo - abuelos/nietos/bisabuelos/familiares políticos",article:"Art. 16",category:"ADMINISTRATIVE",basis:"CALENDAR",annual:null,monthly:null,event:3,extension:null,pay:"100%",notes:"Hasta 3 días corridos según parentesco previsto en la norma."},
  {code:"ART16_1",name:"Duelo - tíos/sobrinos/primos",article:"Art. 16",category:"ADMINISTRATIVE",basis:"CALENDAR",annual:null,monthly:null,event:1,extension:null,pay:"100%",notes:"1 día: fallecimiento o sepelio."},
  {code:"ART17",name:"Representación política",article:"Art. 17",category:"ADMINISTRATIVE",basis:"MANUAL",annual:null,monthly:null,event:null,extension:null,pay:"Sin goce",notes:"Mientras dure el mandato. Requiere 1 año de antigüedad en la docencia."},
  {code:"ART18",name:"Representación gremial",article:"Art. 18",category:"ADMINISTRATIVE",basis:"MANUAL",annual:null,monthly:null,event:null,extension:null,pay:"Sin goce",notes:"Mientras dure el mandato gremial. Sin antigüedad mínima."},
  {code:"ART19_SUP",name:"Preparación y mesa de exámenes - Nivel Superior",article:"Art. 19",category:"ADMINISTRATIVE",basis:"BUSINESS",annual:12,monthly:null,event:3,extension:null,pay:"100%",notes:"Hasta 12 días hábiles/año, fracciones de hasta 3 días hábiles por vez, inmediatos anteriores al examen."},
  {code:"ART19_MEDIA",name:"Preparación y mesa de exámenes - Enseñanza Media",article:"Art. 19",category:"ADMINISTRATIVE",basis:"BUSINESS",annual:8,monthly:null,event:2,extension:null,pay:"100%",notes:"Hasta 8 días hábiles/año, fracciones de hasta 2 días hábiles continuos, incluido el examen."},
  {code:"ART30A",name:"Nacimiento de hijo - docente varón",article:"Art. 30 inc. a",category:"ADMINISTRATIVE",basis:"BUSINESS",annual:null,monthly:null,event:1,extension:null,pay:"100%",notes:"Un día hábil: el día del nacimiento o el inmediato posterior."},
  {code:"ART30B",name:"Razones particulares",article:"Art. 30 inc. b",category:"ADMINISTRATIVE",basis:"CALENDAR",annual:6,monthly:2,event:null,extension:null,pay:"100%",notes:"Hasta 6 días por año calendario y no más de 2 por mes. Sujeto a criterio de autoridad competente."},
  {code:"ART30C",name:"Donación de sangre",article:"Art. 30 inc. c",category:"ADMINISTRATIVE",basis:"CALENDAR",annual:null,monthly:null,event:1,extension:null,pay:"100%",notes:"Justifica el día de la donación. Requiere certificación de establecimiento médico reconocido."}
];

export async function ensureV13Schema(){
  if(migrated)return;
  const sql=db();
  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS force_pin_change BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin_changed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin_change_source TEXT`;
  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin_reset_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS temporary_pin_expires_at TIMESTAMPTZ`;
  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS seniority_date DATE`;
  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS seniority_notes TEXT`;
  // V1.22.1: inicio oficial del cómputo de inasistencias.
  // No se generan ni contabilizan inasistencias hasta el 11/09/2026 inclusive.
  await sql`ALTER TABLE office_settings ADD COLUMN IF NOT EXISTS absence_count_start_date DATE`;
  // Sólo se establece si nunca se fijó. Antes esta sentencia forzaba el valor en cada arranque,
  // igual que la de la tolerancia de 15 minutos que estaba acá abajo: entre las dos revertían
  // cualquier cambio hecho por el administrador desde la pantalla de configuración, en la
  // siguiente instancia fría de serverless. La tolerancia pasó a ser parte de la política de
  // asistencia del organismo (attendance_policies) y ya no se escribe desde una migración.
  await sql`UPDATE office_settings SET absence_count_start_date='2026-09-12'::date,updated_at=now() WHERE id=1 AND absence_count_start_date IS NULL`;
  await sql`CREATE TABLE IF NOT EXISTS employee_devices (
    id BIGSERIAL PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    device_hash TEXT NOT NULL UNIQUE, user_agent TEXT, active BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ)`;
  await sql`ALTER TABLE employee_devices ADD COLUMN IF NOT EXISTS device_family_hash TEXT`;
  await sql`ALTER TABLE employee_devices ADD COLUMN IF NOT EXISTS device_recovery_hash TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_employee_devices_family ON employee_devices(device_family_hash) WHERE active=TRUE`;
  await sql`CREATE INDEX IF NOT EXISTS idx_employee_devices_recovery ON employee_devices(device_recovery_hash) WHERE active=TRUE`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_one_active_device ON employee_devices(employee_id) WHERE active=TRUE`;
  await sql`CREATE INDEX IF NOT EXISTS idx_employee_devices_employee ON employee_devices(employee_id)`;

  // V1.21: secuencia de movimientos durante la jornada.
  // Se amplía attendance_events para admitir REENTRY y se guardan los intervalos
  // de salida intermedia para que Administración clasifique su motivo posteriormente.
  await sql`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='attendance_events_event_type_check') THEN
      ALTER TABLE attendance_events DROP CONSTRAINT attendance_events_event_type_check;
    END IF;
  END $$`;
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='attendance_events_event_type_v121_chk') THEN
      ALTER TABLE attendance_events ADD CONSTRAINT attendance_events_event_type_v121_chk
      CHECK(event_type IN ('ENTRY','EXIT','REENTRY','AUTO_EXIT','ADMIN_EDIT','REJECTED'));
    END IF;
  END $$`;
  await sql`CREATE TABLE IF NOT EXISTS attendance_intervals (
    id BIGSERIAL PRIMARY KEY,
    attendance_day_id BIGINT NOT NULL REFERENCES attendance_days(id) ON DELETE CASCADE,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    exit_event_id BIGINT REFERENCES attendance_events(id) ON DELETE SET NULL,
    reentry_event_id BIGINT REFERENCES attendance_events(id) ON DELETE SET NULL,
    exited_at TIMESTAMPTZ NOT NULL,
    reentered_at TIMESTAMPTZ,
    reason_code TEXT,
    admin_note TEXT,
    counts_as_work BOOLEAN,
    classified_by TEXT,
    classified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_intervals_day ON attendance_intervals(attendance_day_id,exited_at)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_intervals_open ON attendance_intervals(attendance_day_id) WHERE reentered_at IS NULL`;

  await sql`CREATE TABLE IF NOT EXISTS app_users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'CUSTOM',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // V1.25: permite exigir al usuario que reemplace una contraseña temporal.
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`;
  // V1.23: permisos múltiples por usuario. El campo role se conserva por compatibilidad,
  // pero las autorizaciones operativas se resuelven desde app_user_permissions.
  await sql`DO $$ DECLARE c RECORD; BEGIN
    FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app_users'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%role%' LOOP
      EXECUTE format('ALTER TABLE app_users DROP CONSTRAINT %I',c.conname);
    END LOOP;
  END $$`;
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='app_users_role_v123_chk') THEN
      ALTER TABLE app_users ADD CONSTRAINT app_users_role_v123_chk
      CHECK(role IN ('ADMIN','LICENSE_OPERATOR','ATTENDANCE_OPERATOR','CUSTOM'));
    END IF;
  END $$`;
  await sql`CREATE TABLE IF NOT EXISTS app_permissions (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS app_user_permissions (
    user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    permission_code TEXT NOT NULL REFERENCES app_permissions(code) ON DELETE CASCADE,
    granted_by TEXT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,permission_code)
  )`;
  await sql`INSERT INTO app_permissions(code,name,description) VALUES
    ('LICENSES','Operador de Licencias','Registrar y consultar licencias, vacaciones, saldos e historial de licencias.'),
    ('ATTENDANCE','Operador de Asistencia','Consultar registros y realizar marcaciones manuales excepcionales.')
    ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,active=TRUE`;
  // Migración automática de usuarios existentes: conserva los permisos que ya tenían por rol.
  await sql`INSERT INTO app_user_permissions(user_id,permission_code,granted_by)
    SELECT id,'LICENSES','MIGRACION_V1.23' FROM app_users WHERE role IN ('ADMIN','LICENSE_OPERATOR')
    ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO app_user_permissions(user_id,permission_code,granted_by)
    SELECT id,'ATTENDANCE','MIGRACION_V1.23' FROM app_users WHERE role IN ('ADMIN','ATTENDANCE_OPERATOR')
    ON CONFLICT DO NOTHING`;

  await sql`CREATE TABLE IF NOT EXISTS vacation_entitlements (
    id BIGSERIAL PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    benefit_year INTEGER NOT NULL,
    seniority_years INTEGER NOT NULL DEFAULT 0,
    service_months INTEGER NOT NULL DEFAULT 12 CHECK(service_months BETWEEN 0 AND 12),
    extra_fraction_over_15 BOOLEAN NOT NULL DEFAULT FALSE,
    entitlement_days NUMERIC(8,2) NOT NULL,
    notes TEXT,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(employee_id,benefit_year)
  )`;

  await sql`CREATE TABLE IF NOT EXISTS leave_types (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    article TEXT,
    category TEXT NOT NULL CHECK(category IN ('MEDICAL','ADMINISTRATIVE')),
    day_basis TEXT NOT NULL DEFAULT 'CALENDAR' CHECK(day_basis IN ('CALENDAR','BUSINESS','MANUAL')),
    annual_limit INTEGER,
    monthly_limit INTEGER,
    event_limit INTEGER,
    extension_limit INTEGER,
    pay_rule TEXT,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE leave_records ADD COLUMN IF NOT EXISTS leave_type_id BIGINT REFERENCES leave_types(id)`;
  await sql`ALTER TABLE leave_records ADD COLUMN IF NOT EXISTS computed_days INTEGER`;
  await sql`ALTER TABLE leave_records ADD COLUMN IF NOT EXISTS warning_text TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leave_records_type ON leave_records(leave_type_id)`;

  const payload=JSON.stringify(catalog);
  await sql`INSERT INTO leave_types(code,name,article,category,day_basis,annual_limit,monthly_limit,event_limit,extension_limit,pay_rule,notes)
    SELECT x.code,x.name,x.article,x.category,x.basis,x.annual,x.monthly,x.event,x.extension,x.pay,x.notes
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(code text,name text,article text,category text,basis text,annual int,monthly int,event int,extension int,pay text,notes text)
    ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,article=EXCLUDED.article,category=EXCLUDED.category,day_basis=EXCLUDED.day_basis,
      annual_limit=EXCLUDED.annual_limit,monthly_limit=EXCLUDED.monthly_limit,event_limit=EXCLUDED.event_limit,extension_limit=EXCLUDED.extension_limit,
      pay_rule=EXCLUDED.pay_rule,notes=EXCLUDED.notes,updated_at=now()`;
  migrated=true;
}

export async function ensureHistoricalLicenseImportSchema(){
  await ensureV13Schema();
  const sql=db();
  await sql`CREATE TABLE IF NOT EXISTS historical_leave_import (
    id BIGSERIAL PRIMARY KEY,
    source_file TEXT NOT NULL,
    source_page INTEGER NOT NULL,
    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
    confidence TEXT NOT NULL DEFAULT 'UNMATCHED',
    match_method TEXT,
    article_text TEXT,
    date_from DATE,
    date_to DATE,
    quantity_value NUMERIC,
    quantity_unit TEXT CHECK(quantity_unit IN ('DAYS','HOURS')),
    raw_excerpt TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','REJECTED')),
    imported_leave_id BIGINT REFERENCES leave_records(id) ON DELETE SET NULL,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(source_file, source_page)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hist_leave_status ON historical_leave_import(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hist_leave_employee ON historical_leave_import(employee_id)`;
}

export async function ensureV119LeaveDetailSchema(){
  await ensureV13Schema();
  const sql=db();
  await sql`ALTER TABLE leave_records ADD COLUMN IF NOT EXISTS source_article TEXT`;
  await sql`ALTER TABLE leave_records ADD COLUMN IF NOT EXISTS quantity_value NUMERIC`;
  await sql`ALTER TABLE leave_records ADD COLUMN IF NOT EXISTS quantity_unit TEXT`;
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='leave_records_quantity_unit_chk') THEN
      ALTER TABLE leave_records ADD CONSTRAINT leave_records_quantity_unit_chk CHECK(quantity_unit IS NULL OR quantity_unit IN ('DAYS','HOURS'));
    END IF;
  END $$`;
}
