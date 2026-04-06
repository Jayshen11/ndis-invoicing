import { sql } from "kysely";
import { db } from "@/db/client";
import type {
  RateSetImportGridColumn,
  RateSetImportGridRow,
} from "@/modules/rate-set/types";

let rateSetInvoiceSchemaPromise: Promise<void> | null = null;

/**
 * SEC: Rate-set DDL + migrations toward `src/db/ndis_excel_import_logic.sql` (NDIS Excel import).
 * Legacy minimal tables are created first; migrateNdisExcelImportSchema() aligns columns and adds reference data.
 */
export async function ensureRateSetInvoiceSchema(): Promise<void> {
  if (process.env.RBAC_SKIP_DDL === "1") {
    return;
  }

  rateSetInvoiceSchemaPromise ??= runRateSetInvoicePatches().catch((error) => {
    rateSetInvoiceSchemaPromise = null;
    throw error;
  });

  return rateSetInvoiceSchemaPromise;
}

async function runRateSetInvoicePatches(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS rate_set (
      id SERIAL PRIMARY KEY,
      start_date DATE NOT NULL,
      end_date DATE NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    ALTER TABLE rate_set ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''
  `.execute(db);

  await sql`
    ALTER TABLE rate_set ADD COLUMN IF NOT EXISTS description TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE rate_set ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL
  `.execute(db);

  await sql`
    ALTER TABLE rate_set ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS rate_set_deleted_at_idx ON rate_set (deleted_at)
      WHERE deleted_at IS NULL
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS rate_set_category (
      id SERIAL PRIMARY KEY,
      rate_set_id INTEGER NOT NULL REFERENCES rate_set (id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS rate_set_support_item (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES rate_set_category (id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS rate_set_support_item_price (
      id SERIAL PRIMARY KEY,
      rate_set_id INTEGER NOT NULL REFERENCES rate_set (id) ON DELETE CASCADE,
      rate_set_support_item_id INTEGER NOT NULL REFERENCES rate_set_support_item (id) ON DELETE CASCADE,
      pricing_region TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NULL,
      unit_price NUMERIC(14, 4) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await migrateNdisExcelImportSchema();
}

/**
 * Aligns legacy tables with NDIS Excel import spec (category_number, item_number, price.type_id, etc.).
 */
async function migrateNdisExcelImportSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS rate_set_support_item_attribute_type (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deactivated_at TIMESTAMPTZ NULL
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS rate_set_support_item_type (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deactivated_at TIMESTAMPTZ NULL
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS rate_set_support_item_pricing_region (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE,
      full_label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deactivated_at TIMESTAMPTZ NULL
    )
  `.execute(db);

  await sql`
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
    ON CONFLICT (code) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO rate_set_support_item_attribute_type (code, label)
    VALUES
      ('IS_QUOTE_REQUIRED', 'Quote'),
      ('IS_NF2F_SUPPORT_PROVISION', 'Non-Face-to-Face Support Provision'),
      ('IS_PROVIDER_TRAVEL', 'Provider Travel'),
      ('IS_SHORT_NOTICE_CANCEL', 'Short Notice Cancellations.'),
      ('IS_NDIA_REQUESTED_REPORTS', 'NDIA Requested Reports'),
      ('IS_IRREGULAR_SIL_SUPPORTS', 'Irregular SIL Supports')
    ON CONFLICT (code) DO NOTHING
  `.execute(db);

  await sql`
    DO $migrate$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rate_set'
          AND column_name = 'start_date' AND data_type = 'date'
      ) THEN
        ALTER TABLE rate_set
          ALTER COLUMN start_date TYPE timestamptz
          USING start_date::timestamp AT TIME ZONE 'UTC';
        ALTER TABLE rate_set
          ALTER COLUMN end_date TYPE timestamptz
          USING CASE
            WHEN end_date IS NULL THEN NULL
            ELSE end_date::timestamp AT TIME ZONE 'UTC'
          END;
      END IF;
    END
    $migrate$
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_category ADD COLUMN IF NOT EXISTS category_number TEXT
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_category ADD COLUMN IF NOT EXISTS category_name TEXT
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_category ADD COLUMN IF NOT EXISTS sorting INTEGER NOT NULL DEFAULT 0
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_category ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_category ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
  `.execute(db);

  await sql`
    DO $cat_label$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rate_set_category'
          AND column_name = 'label'
      ) THEN
        UPDATE rate_set_category c
        SET
          category_name = COALESCE(c.category_name, c.label),
          category_number = COALESCE(NULLIF(TRIM(c.category_number), ''), '0')
        WHERE c.category_name IS NULL OR c.category_number IS NULL OR TRIM(c.category_number) = '';
      END IF;
    END
    $cat_label$
  `.execute(db);

  await sql`
    UPDATE rate_set_category
    SET category_name = COALESCE(category_name, 'Category')
    WHERE category_name IS NULL
  `.execute(db);

  await sql`
    UPDATE rate_set_category
    SET category_number = COALESCE(NULLIF(TRIM(category_number), ''), '0')
    WHERE category_number IS NULL OR TRIM(category_number) = ''
  `.execute(db);

  await sql`
    UPDATE rate_set_category
    SET category_number = id::text
    WHERE category_number = '0'
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_category ALTER COLUMN category_number SET NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_category ALTER COLUMN category_name SET NOT NULL
  `.execute(db);

  await sql`
    DO $drop_label$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rate_set_category'
          AND column_name = 'label'
      ) THEN
        ALTER TABLE rate_set_category DROP COLUMN label;
      END IF;
    END
    $drop_label$
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_support_item ADD COLUMN IF NOT EXISTS rate_set_id INTEGER
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_support_item ADD COLUMN IF NOT EXISTS item_number TEXT
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_support_item ADD COLUMN IF NOT EXISTS item_name TEXT
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_support_item ADD COLUMN IF NOT EXISTS unit TEXT
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_support_item ADD COLUMN IF NOT EXISTS sorting INTEGER NOT NULL DEFAULT 0
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_support_item ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL
  `.execute(db);
  await sql`
    ALTER TABLE rate_set_support_item ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
  `.execute(db);

  await sql`
    UPDATE rate_set_support_item s
    SET rate_set_id = c.rate_set_id
    FROM rate_set_category c
    WHERE s.category_id = c.id AND s.rate_set_id IS NULL
  `.execute(db);

  await sql`
    DO $item_label$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rate_set_support_item'
          AND column_name = 'label'
      ) THEN
        UPDATE rate_set_support_item s
        SET
          item_name = COALESCE(s.item_name, s.label),
          item_number = COALESCE(NULLIF(TRIM(s.item_number), ''), s.id::text)
        WHERE s.item_name IS NULL OR s.item_number IS NULL OR TRIM(s.item_number) = '';
      END IF;
    END
    $item_label$
  `.execute(db);

  await sql`
    UPDATE rate_set_support_item
    SET item_name = COALESCE(item_name, 'Item')
    WHERE item_name IS NULL
  `.execute(db);

  await sql`
    UPDATE rate_set_support_item
    SET item_number = COALESCE(item_number, id::text)
    WHERE item_number IS NULL OR TRIM(item_number) = ''
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_support_item ALTER COLUMN rate_set_id SET NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_support_item ALTER COLUMN item_number SET NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_support_item ALTER COLUMN item_name SET NOT NULL
  `.execute(db);

  await sql`
    DO $drop_item_label$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rate_set_support_item'
          AND column_name = 'label'
      ) THEN
        ALTER TABLE rate_set_support_item DROP COLUMN label;
      END IF;
    END
    $drop_item_label$
  `.execute(db);

  await sql`
    DO $fk_rate_set$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'rate_set_support_item_rate_set_id_fkey'
      ) THEN
        ALTER TABLE rate_set_support_item
          ADD CONSTRAINT rate_set_support_item_rate_set_id_fkey
          FOREIGN KEY (rate_set_id) REFERENCES rate_set (id) ON DELETE CASCADE;
      END IF;
    END
    $fk_rate_set$
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS rate_set_support_item_attribute (
      id SERIAL PRIMARY KEY,
      support_item_id INTEGER NOT NULL REFERENCES rate_set_support_item (id) ON DELETE CASCADE,
      attribute_code TEXT NOT NULL REFERENCES rate_set_support_item_attribute_type (code),
      value BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (support_item_id, attribute_code)
    )
  `.execute(db);

  await sql`
    DO $rename_price_cols$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rate_set_support_item_price'
          AND column_name = 'rate_set_support_item_id'
      ) THEN
        ALTER TABLE rate_set_support_item_price
          RENAME COLUMN rate_set_support_item_id TO support_item_id;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rate_set_support_item_price'
          AND column_name = 'pricing_region'
      ) THEN
        ALTER TABLE rate_set_support_item_price
          RENAME COLUMN pricing_region TO pricing_region_code;
      END IF;
    END
    $rename_price_cols$
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_support_item_price
      ADD COLUMN IF NOT EXISTS type_id INTEGER REFERENCES rate_set_support_item_type (id)
  `.execute(db);

  await sql`
    DO $price_dates$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rate_set_support_item_price'
          AND column_name = 'start_date' AND data_type = 'date'
      ) THEN
        ALTER TABLE rate_set_support_item_price
          ALTER COLUMN start_date TYPE timestamptz
          USING start_date::timestamp AT TIME ZONE 'UTC';
        ALTER TABLE rate_set_support_item_price
          ALTER COLUMN end_date TYPE timestamptz
          USING CASE
            WHEN end_date IS NULL THEN NULL
            ELSE end_date::timestamp AT TIME ZONE 'UTC'
          END;
      END IF;
    END
    $price_dates$
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_support_item_price
      ALTER COLUMN unit_price TYPE NUMERIC(24, 4)
  `.execute(db);

  await sql`
    ALTER TABLE rate_set_support_item_price
      ALTER COLUMN unit_price DROP NOT NULL
  `.execute(db);

  // SEC: Optional FK pricing_region_code → catalogue; skipped if legacy rows use unknown codes.
  await sql`
    DO $price_fk$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rate_set_support_item_price_pricing_region_fk'
      ) THEN
        ALTER TABLE rate_set_support_item_price
          ADD CONSTRAINT rate_set_support_item_price_pricing_region_fk
          FOREIGN KEY (pricing_region_code)
          REFERENCES rate_set_support_item_pricing_region (code);
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'rate_set_support_item_price pricing_region FK not applied (clean data first).';
    END
    $price_fk$
  `.execute(db);

  await sql`
    DO $price_unique$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'rate_set_support_item_price_business_uidx'
      ) THEN
        ALTER TABLE rate_set_support_item_price
          ADD CONSTRAINT rate_set_support_item_price_business_uidx
          UNIQUE (
            rate_set_id,
            support_item_id,
            type_id,
            pricing_region_code,
            start_date,
            end_date
          );
      END IF;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN unique_violation THEN NULL;
    END
    $price_unique$
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS rate_set_category_rate_number_uidx
    ON rate_set_category (rate_set_id, category_number)
    WHERE deleted_at IS NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS rate_set_support_item_rate_item_uidx
    ON rate_set_support_item (rate_set_id, item_number)
    WHERE deleted_at IS NULL
  `.execute(db);
}

export type RateSetCategoryOptionRow = {
  id: number;
  label: string;
};

export type RateSetSupportItemOptionRow = {
  id: number;
  label: string;
};

export const RATE_SET_IMPORT_GRID_COLUMNS: RateSetImportGridColumn[] = [
  { key: "A", title: "Support Item Number" },
  { key: "B", title: "Support Item Name" },
  { key: "F", title: "Support Category Number" },
  { key: "H", title: "Support Category Name" },
  { key: "I", title: "Unit" },
  { key: "J", title: "Quote" },
  { key: "K", title: "Start Date" },
  { key: "L", title: "End Date" },
  { key: "M", title: "ACT" },
  { key: "N", title: "NSW" },
  { key: "O", title: "NT" },
  { key: "P", title: "QLD" },
  { key: "Q", title: "SA" },
  { key: "R", title: "TAS" },
  { key: "S", title: "VIC" },
  { key: "T", title: "WA" },
  { key: "U", title: "Remote" },
  { key: "V", title: "Very Remote" },
  { key: "W", title: "Non-Face-to-Face Support Provision" },
  { key: "X", title: "Provider Travel" },
  { key: "Y", title: "Short Notice Cancellations." },
  { key: "Z", title: "NDIA Requested Reports" },
  { key: "AA", title: "Irregular SIL Supports" },
  { key: "AB", title: "Type" },
];

export async function hasImportedRatesForRateSet(
  rateSetId: number,
): Promise<boolean> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<{ ok: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM rate_set_support_item_price p
      WHERE p.rate_set_id = ${rateSetId}
    ) AS ok
  `.execute(db);

  return result.rows[0]?.ok ?? false;
}

export async function getRateSetImportGridRows(
  rateSetId: number,
): Promise<RateSetImportGridRow[]> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<RateSetImportGridRow>`
    SELECT
      concat(
        s.id::text,
        '|',
        coalesce(t.label, ''),
        '|',
        p.start_date::text,
        '|',
        coalesce(p.end_date::text, '9999-12-31T23:59:59.999Z')
      ) AS id,
      s.item_number AS "A",
      s.item_name AS "B",
      c.category_number AS "F",
      c.category_name AS "H",
      s.unit AS "I",
      coalesce(attr_quote.value, false) AS "J",
      p.start_date::text AS "K",
      coalesce(p.end_date::text, '9999-12-31T23:59:59.999Z') AS "L",
      max(CASE WHEN p.pricing_region_code = 'ACT' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "M",
      max(CASE WHEN p.pricing_region_code = 'NSW' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "N",
      max(CASE WHEN p.pricing_region_code = 'NT' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "O",
      max(CASE WHEN p.pricing_region_code = 'QLD' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "P",
      max(CASE WHEN p.pricing_region_code = 'SA' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "Q",
      max(CASE WHEN p.pricing_region_code = 'TAS' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "R",
      max(CASE WHEN p.pricing_region_code = 'VIC' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "S",
      max(CASE WHEN p.pricing_region_code = 'WA' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "T",
      max(CASE WHEN p.pricing_region_code = 'REMOTE' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "U",
      max(CASE WHEN p.pricing_region_code = 'VERY_REMOTE' THEN trim(to_char(p.unit_price, 'FM999999999999990.0000')) END) AS "V",
      coalesce(attr_nf2f.value, false) AS "W",
      coalesce(attr_travel.value, false) AS "X",
      coalesce(attr_short_notice.value, false) AS "Y",
      coalesce(attr_ndia_reports.value, false) AS "Z",
      coalesce(attr_irregular_sil.value, false) AS "AA",
      t.label AS "AB",
      t.id AS "AC"
    FROM rate_set_support_item_price p
    INNER JOIN rate_set_support_item s
      ON s.id = p.support_item_id
      AND s.deleted_at IS NULL
    INNER JOIN rate_set_category c
      ON c.id = s.category_id
      AND c.deleted_at IS NULL
    LEFT JOIN rate_set_support_item_type t ON t.id = p.type_id
    LEFT JOIN rate_set_support_item_attribute attr_quote
      ON attr_quote.support_item_id = s.id
      AND attr_quote.attribute_code = 'IS_QUOTE_REQUIRED'
    LEFT JOIN rate_set_support_item_attribute attr_nf2f
      ON attr_nf2f.support_item_id = s.id
      AND attr_nf2f.attribute_code = 'IS_NF2F_SUPPORT_PROVISION'
    LEFT JOIN rate_set_support_item_attribute attr_travel
      ON attr_travel.support_item_id = s.id
      AND attr_travel.attribute_code = 'IS_PROVIDER_TRAVEL'
    LEFT JOIN rate_set_support_item_attribute attr_short_notice
      ON attr_short_notice.support_item_id = s.id
      AND attr_short_notice.attribute_code = 'IS_SHORT_NOTICE_CANCEL'
    LEFT JOIN rate_set_support_item_attribute attr_ndia_reports
      ON attr_ndia_reports.support_item_id = s.id
      AND attr_ndia_reports.attribute_code = 'IS_NDIA_REQUESTED_REPORTS'
    LEFT JOIN rate_set_support_item_attribute attr_irregular_sil
      ON attr_irregular_sil.support_item_id = s.id
      AND attr_irregular_sil.attribute_code = 'IS_IRREGULAR_SIL_SUPPORTS'
    WHERE p.rate_set_id = ${rateSetId}
    GROUP BY
      s.id,
      s.item_number,
      s.item_name,
      c.category_number,
      c.category_name,
      c.sorting,
      s.sorting,
      s.unit,
      attr_quote.value,
      attr_nf2f.value,
      attr_travel.value,
      attr_short_notice.value,
      attr_ndia_reports.value,
      attr_irregular_sil.value,
      p.start_date,
      p.end_date,
      t.id,
      t.label
    ORDER BY
      c.sorting ASC,
      c.category_number ASC,
      s.sorting ASC,
      s.item_number ASC,
      p.start_date ASC,
      coalesce(t.label, '') ASC
  `.execute(db);

  return result.rows;
}

/** Overlap: rate_set.start_date <= itemEnd AND (rate_set.end_date IS NULL OR rate_set.end_date >= itemStart). */
export async function listOverlappingRateSetIds(
  itemStartYmd: string,
  itemEndYmd: string,
): Promise<number[]> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<{ id: number }>`
    SELECT rs.id
    FROM rate_set rs
    WHERE rs.deleted_at IS NULL
      AND rs.deactivated_at IS NULL
      AND (rs.start_date AT TIME ZONE 'UTC')::date <= ${itemEndYmd}::date
      AND (
        rs.end_date IS NULL
        OR (rs.end_date AT TIME ZONE 'UTC')::date >= ${itemStartYmd}::date
      )
    ORDER BY rs.id ASC
  `.execute(db);

  return result.rows.map((r) => r.id);
}

export async function listRateSetCategories(
  rateSetId: number,
): Promise<RateSetCategoryOptionRow[]> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<RateSetCategoryOptionRow>`
    SELECT
      id,
      category_name || ' (' || category_number || ')' AS label
    FROM rate_set_category
    WHERE rate_set_id = ${rateSetId}
      AND deleted_at IS NULL
      AND deactivated_at IS NULL
    ORDER BY sorting ASC, category_number ASC, id ASC
  `.execute(db);

  return result.rows;
}

export async function categoryBelongsToRateSet(
  categoryId: number,
  rateSetId: number,
): Promise<boolean> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<{ ok: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM rate_set_category c
      WHERE c.id = ${categoryId}
        AND c.rate_set_id = ${rateSetId}
        AND c.deleted_at IS NULL
    ) AS ok
  `.execute(db);

  return result.rows[0]?.ok ?? false;
}

export async function supportItemBelongsToCategory(
  supportItemId: number,
  categoryId: number,
): Promise<boolean> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<{ ok: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM rate_set_support_item s
      WHERE s.id = ${supportItemId}
        AND s.category_id = ${categoryId}
        AND s.deleted_at IS NULL
    ) AS ok
  `.execute(db);

  return result.rows[0]?.ok ?? false;
}

export async function listSupportItemsForCategory(
  categoryId: number,
): Promise<RateSetSupportItemOptionRow[]> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<RateSetSupportItemOptionRow>`
    SELECT id, item_name AS label
    FROM rate_set_support_item
    WHERE category_id = ${categoryId}
      AND deleted_at IS NULL
      AND deactivated_at IS NULL
    ORDER BY sorting ASC, item_number ASC, id ASC
  `.execute(db);

  return result.rows;
}

/**
 * Price rows overlapping item service range for region.
 * Prefers rows with type_id IS NULL (legacy / default); otherwise returns all matches (caller may treat as ambiguous).
 */
export async function listMatchingUnitPrices(
  rateSetId: number,
  supportItemId: number,
  pricingRegion: string,
  itemStartYmd: string,
  itemEndYmd: string,
): Promise<string[]> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<{ unit_price: string }>`
    SELECT p.unit_price::text AS unit_price
    FROM rate_set_support_item_price p
    WHERE p.rate_set_id = ${rateSetId}
      AND p.support_item_id = ${supportItemId}
      AND p.pricing_region_code = ${pricingRegion}
      AND p.unit_price IS NOT NULL
      AND (p.start_date AT TIME ZONE 'UTC')::date <= ${itemEndYmd}::date
      AND (
        p.end_date IS NULL
        OR (p.end_date AT TIME ZONE 'UTC')::date >= ${itemStartYmd}::date
      )
      AND p.type_id IS NULL
    ORDER BY p.id ASC
  `.execute(db);

  if (result.rows.length > 0) {
    return result.rows.map((r) => r.unit_price);
  }

  const fallback = await sql<{ unit_price: string }>`
    SELECT p.unit_price::text AS unit_price
    FROM rate_set_support_item_price p
    WHERE p.rate_set_id = ${rateSetId}
      AND p.support_item_id = ${supportItemId}
      AND p.pricing_region_code = ${pricingRegion}
      AND p.unit_price IS NOT NULL
      AND (p.start_date AT TIME ZONE 'UTC')::date <= ${itemEndYmd}::date
      AND (
        p.end_date IS NULL
        OR (p.end_date AT TIME ZONE 'UTC')::date >= ${itemStartYmd}::date
      )
    ORDER BY p.id ASC
  `.execute(db);

  return fallback.rows.map((r) => r.unit_price);
}
