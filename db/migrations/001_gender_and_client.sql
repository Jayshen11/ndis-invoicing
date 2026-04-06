-- NDIS Invoicing — participants (client) + gender reference data
-- Safe to run multiple times (IF NOT EXISTS).
-- Aligns with src/repositories/gender.repository.ts and client.repository.ts expectations.

CREATE TABLE IF NOT EXISTS gender (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false
);

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
  pricing_region TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_client_deleted_at ON client (deleted_at);
CREATE INDEX IF NOT EXISTS idx_client_last_name_first_name ON client (last_name, first_name);
