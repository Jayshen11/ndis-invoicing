-- NDIS Excel import — canonical table definitions (see project spec §9.5).
-- Applied programmatically via ensureRateSetInvoiceSchema() with migrations for existing DBs.

-- A "Rate Set" must be created first to hold all of the imported Excel rows
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

-- Excel F → category_number, H → category_name; unique category_number per rate_set; sorting by numeric category_number
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

-- Excel A/B/I + category; unique (rate_set_id, item_number); sorting per rate set
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
