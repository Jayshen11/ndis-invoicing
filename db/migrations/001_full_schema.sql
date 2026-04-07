-- NDIS Invoicing — full baseline schema (Neon / fresh Postgres).
-- Run once on an empty database. Uses IF NOT EXISTS / idempotent seeds where practical.
-- Aligned with src/repositories/* (invoice columns, auth_session, audit_log, rbac_permission ids).

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Rate sets (NDIS Excel import core)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_set (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  description text,
  start_date timestamptz NOT NULL,
  end_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  deleted_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rate_set_valid_range_chk'
  ) THEN
    ALTER TABLE rate_set
      ADD CONSTRAINT rate_set_valid_range_chk
      CHECK (end_date IS NULL OR start_date <= end_date);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rate_set_no_overlap_excl'
  ) THEN
    ALTER TABLE rate_set
      ADD CONSTRAINT rate_set_no_overlap_excl
      EXCLUDE USING gist (
        tstzrange(start_date, coalesce(end_date, 'infinity'::timestamptz), '[]') WITH &&
      )
      WHERE (deleted_at IS NULL);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS rate_set_category (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_set_id int NOT NULL REFERENCES rate_set(id),
  category_number text NOT NULL,
  category_name text NOT NULL,
  sorting int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS rsc_unique1_idx
  ON rate_set_category (rate_set_id, category_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS rsc_category_id
  ON rate_set_category (rate_set_id);

CREATE TABLE IF NOT EXISTS rate_set_support_item (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_set_id int NOT NULL REFERENCES rate_set(id),
  category_id int NOT NULL REFERENCES rate_set_category(id),
  item_number text NOT NULL,
  item_name text NOT NULL,
  unit text,
  sorting int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS rssi_unique1_idx
  ON rate_set_support_item (rate_set_id, category_id, item_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS rssi_rate_set_id
  ON rate_set_support_item (rate_set_id);

CREATE INDEX IF NOT EXISTS rssi_category_id
  ON rate_set_support_item (category_id);

CREATE TABLE IF NOT EXISTS rate_set_support_item_attribute_type (
  code text PRIMARY KEY,
  label text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);

CREATE TABLE IF NOT EXISTS rate_set_support_item_attribute (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  support_item_id int NOT NULL REFERENCES rate_set_support_item(id),
  attribute_code text NOT NULL REFERENCES rate_set_support_item_attribute_type(code),
  value boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (support_item_id, attribute_code)
);

CREATE INDEX IF NOT EXISTS rssia_category_support_item_id
  ON rate_set_support_item_attribute (support_item_id);

CREATE INDEX IF NOT EXISTS rssia_attribute_code
  ON rate_set_support_item_attribute (attribute_code);

CREATE TABLE IF NOT EXISTS rate_set_support_item_type (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);

CREATE TABLE IF NOT EXISTS rate_set_support_item_pricing_region (
  code text PRIMARY KEY,
  label text NOT NULL UNIQUE,
  full_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);

CREATE TABLE IF NOT EXISTS rate_set_support_item_price (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_set_id int NOT NULL REFERENCES rate_set(id),
  support_item_id int NOT NULL REFERENCES rate_set_support_item(id),
  type_id int REFERENCES rate_set_support_item_type(id),
  pricing_region_code text REFERENCES rate_set_support_item_pricing_region(code),
  unit_price numeric(24, 4),
  start_date timestamptz NOT NULL,
  end_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    rate_set_id,
    support_item_id,
    type_id,
    pricing_region_code,
    start_date,
    end_date
  )
);

CREATE INDEX IF NOT EXISTS rssip_category_support_item_id
  ON rate_set_support_item_price (support_item_id);

-- Pricing regions required before client.pricing_region FK (common NDIS region codes).
INSERT INTO rate_set_support_item_pricing_region (code, label, full_label)
VALUES
  ('ACT', 'ACT', 'Australian Capital Territory'),
  ('NSW', 'NSW', 'New South Wales'),
  ('NT', 'NT', 'Northern Territory'),
  ('QLD', 'QLD', 'Queensland'),
  ('SA', 'SA', 'South Australia'),
  ('TAS', 'TAS', 'Tasmania'),
  ('VIC', 'VIC', 'Victoria'),
  ('WA', 'WA', 'Western Australia'),
  ('REMOTE', 'Remote', 'Remote'),
  ('VERY_REMOTE', 'Very Remote', 'Very Remote')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Gender + client (participants) — matches gender.repository.ts expectations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gender (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ NULL
);

INSERT INTO gender (code, label)
VALUES
  ('FEMALE', 'Female'),
  ('MALE', 'Male'),
  ('UNIDENTIFIED', 'Unidentified')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS client (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender_id INTEGER NOT NULL REFERENCES gender (id),
  dob DATE NOT NULL,
  ndis_number TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_number TEXT NULL,
  address TEXT NOT NULL,
  unit_building TEXT NULL,
  pricing_region TEXT NOT NULL REFERENCES rate_set_support_item_pricing_region (code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS client_unique_ndis_number
  ON client (ndis_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_deleted_at ON client (deleted_at);
CREATE INDEX IF NOT EXISTS idx_client_last_name_first_name ON client (last_name, first_name);

-- ---------------------------------------------------------------------------
-- Provider + invoice — matches invoice.repository.ts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS provider (
  id SERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_number TEXT NULL,
  address TEXT NULL,
  unit_building TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS invoice (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES client (id),
  provider_id INTEGER NOT NULL REFERENCES provider (id),
  status TEXT NOT NULL DEFAULT 'drafted'
    CHECK (status IN ('drafted', 'completed')),
  invoice_number TEXT NOT NULL,
  invoice_date TIMESTAMPTZ NOT NULL,
  amount NUMERIC(14, 4) NULL,
  expected_amount NUMERIC(14, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_provider_number_active_uidx
  ON invoice (provider_id, lower(trim(invoice_number)))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS invoice_deleted_at_idx ON invoice (deleted_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS invoice_client_id ON invoice (client_id);
CREATE INDEX IF NOT EXISTS invoice_provider_id ON invoice (provider_id);

CREATE TABLE IF NOT EXISTS invoice_item (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoice (id) ON DELETE CASCADE,
  rate_set_id INTEGER NULL REFERENCES rate_set (id),
  category_id INTEGER NULL REFERENCES rate_set_category (id),
  support_item_id INTEGER NULL REFERENCES rate_set_support_item (id),
  start_date TIMESTAMPTZ NULL,
  end_date TIMESTAMPTZ NULL,
  max_rate NUMERIC(14, 4) NULL,
  unit NUMERIC(14, 4) NULL,
  input_rate NUMERIC(14, 4) NULL,
  amount NUMERIC(14, 4) NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_item_invoice_id_idx ON invoice_item (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_item_rate_set_id ON invoice_item (rate_set_id);
CREATE INDEX IF NOT EXISTS invoice_item_category_id ON invoice_item (category_id);
CREATE INDEX IF NOT EXISTS invoice_item_support_item_id ON invoice_item (support_item_id);

-- ---------------------------------------------------------------------------
-- App users + RBAC (rbac_role / rbac_permission before auth_session)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_user (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email_lower
  ON app_user (lower(btrim(email)))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS rbac_role (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL UNIQUE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  permissions TEXT NOT NULL DEFAULT '[]'
);

-- Stable numeric ids must match src/modules/user-role/permissions-catalog.ts (gateway contract).
CREATE TABLE IF NOT EXISTS rbac_permission (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO rbac_permission (id, code, label, created_at)
VALUES
  (1, 'clients.read', 'Read clients', '2026-03-13T03:24:25.042Z'::timestamptz),
  (2, 'clients.write', 'Add or edit clients', '2026-03-13T03:24:25.042Z'::timestamptz),
  (3, 'clients.delete', 'Delete clients', '2026-03-13T03:24:25.042Z'::timestamptz),
  (4, 'providers.read', 'Read providers', '2026-03-13T03:24:25.042Z'::timestamptz),
  (5, 'providers.write', 'Add or edit providers', '2026-03-13T03:24:25.042Z'::timestamptz),
  (6, 'providers.delete', 'Delete providers', '2026-03-13T03:24:25.042Z'::timestamptz),
  (7, 'rate_sets.read', 'Read rate sets', '2026-03-13T03:24:25.042Z'::timestamptz),
  (8, 'rate_sets.write', 'Add or edit rate sets', '2026-03-13T03:24:25.042Z'::timestamptz),
  (9, 'rate_sets.delete', 'Delete rate sets', '2026-03-13T03:24:25.042Z'::timestamptz),
  (10, 'rate_sets.import', 'Import rate sets', '2026-03-13T03:24:25.042Z'::timestamptz),
  (11, 'invoices.read', 'Read invoices', '2026-03-13T03:24:25.042Z'::timestamptz),
  (12, 'invoices.write', 'Add or edit invoices', '2026-03-13T03:24:25.042Z'::timestamptz),
  (13, 'invoices.delete', 'Delete invoices', '2026-03-13T03:24:25.042Z'::timestamptz),
  (14, 'users.read', 'Read users', '2026-03-13T03:24:25.042Z'::timestamptz),
  (15, 'users.write', 'Add or edit users', '2026-03-13T03:24:25.042Z'::timestamptz),
  (16, 'users.delete', 'Delete users', '2026-03-13T03:24:25.042Z'::timestamptz),
  (17, 'user_roles.read', 'Read user roles', '2026-03-13T03:24:25.042Z'::timestamptz),
  (18, 'user_roles.write', 'Add or edit user roles', '2026-03-13T03:24:25.042Z'::timestamptz),
  (19, 'user_roles.delete', 'Delete user roles', '2026-03-13T03:24:25.042Z'::timestamptz),
  (20, 'genders.read', 'Read genders', '2026-03-13T03:24:25.042Z'::timestamptz),
  (21, 'genders.write', 'Add or edit genders', '2026-03-13T03:24:25.042Z'::timestamptz),
  (22, 'genders.delete', 'Delete genders', '2026-03-13T03:24:25.042Z'::timestamptz),
  (23, 'auth_sessions.read', 'Read auth sessions', '2026-03-13T03:24:25.042Z'::timestamptz),
  (24, 'auth_sessions.revoke', 'Revoke auth sessions', '2026-03-13T03:24:25.042Z'::timestamptz),
  (25, 'auth_sessions.delete', 'Delete auth sessions', '2026-03-13T03:24:25.042Z'::timestamptz),
  (26, 'audit_logs.read', 'Read audit logs', '2026-03-13T03:24:25.042Z'::timestamptz)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label;

CREATE TABLE IF NOT EXISTS rbac_user_role_permission (
  role_id INTEGER NOT NULL REFERENCES rbac_role (id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES rbac_permission (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS rbac_user_role_permission_permission_idx
  ON rbac_user_role_permission (permission_id);

-- One role row per user (matches app-user.repository.ts).
CREATE TABLE IF NOT EXISTS rbac_user_role (
  user_id INTEGER NOT NULL PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES rbac_role (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rbac_user_role_role_id ON rbac_user_role (role_id);

INSERT INTO rbac_role (code, label, is_default)
VALUES
  ('SUPER_ADMIN', 'Super Admin', true),
  ('BILLING_OFFICER', 'Billing Officer', false),
  ('DATA_ENTRY', 'Data Entry', false),
  ('AUDITOR', 'Auditor', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac_user_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_role r
CROSS JOIN rbac_permission p
WHERE r.code = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO rbac_user_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_role r
JOIN rbac_permission p ON p.code = ANY (ARRAY[
  'clients.read',
  'clients.write',
  'providers.read',
  'providers.write',
  'rate_sets.read',
  'invoices.read',
  'invoices.write',
  'genders.read',
  'genders.write'
])
WHERE r.code = 'BILLING_OFFICER'
ON CONFLICT DO NOTHING;

INSERT INTO rbac_user_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_role r
JOIN rbac_permission p ON p.code = ANY (ARRAY[
  'clients.read',
  'providers.read',
  'invoices.read',
  'invoices.write'
])
WHERE r.code = 'DATA_ENTRY'
ON CONFLICT DO NOTHING;

INSERT INTO rbac_user_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_role r
JOIN rbac_permission p ON p.code = ANY (ARRAY[
  'clients.read',
  'providers.read',
  'rate_sets.read',
  'invoices.read'
])
WHERE r.code = 'AUDITOR'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS auth_password (
  user_id INTEGER NOT NULL PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Matches auth-session.repository.ts (csrf_token; token_hash optional legacy).
CREATE TABLE IF NOT EXISTS auth_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES rbac_role (id) ON DELETE CASCADE,
  token_hash TEXT NULL UNIQUE,
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  csrf_token TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user_id ON auth_session (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_role_id ON auth_session (role_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_expires_at ON auth_session (expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_session_created_at ON auth_session (created_at DESC);

-- Matches audit-log.repository.ts insert/list columns.
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NULL REFERENCES app_user (id) ON DELETE SET NULL,
  user_label TEXT NULL,
  role_id INTEGER NULL,
  role_label TEXT NULL,
  action TEXT NOT NULL,
  action_label TEXT NOT NULL,
  permission TEXT NULL,
  permission_label TEXT NULL,
  entity TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  entity_id TEXT NULL,
  payload JSONB NULL,
  changes_diff JSONB NULL,
  before TEXT NULL,
  after TEXT NULL,
  before_data JSONB NULL,
  after_data JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_role_id ON audit_log (role_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_permission ON audit_log (permission);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity);
