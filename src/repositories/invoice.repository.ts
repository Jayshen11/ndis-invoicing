import { sql } from "kysely";
import { db } from "@/db/client";
import type {
  InvoiceItemRow,
  InvoiceListFilters,
  InvoiceListRow,
} from "@/modules/invoice/types";
import { ensureRateSetInvoiceSchema } from "@/repositories/rate-set-invoice.repository";

let invoiceSchemaPromise: Promise<void> | null = null;

export async function ensureInvoiceSchema(): Promise<void> {
  if (process.env.RBAC_SKIP_DDL === "1") {
    return;
  }

  invoiceSchemaPromise ??= runInvoiceSchemaPatches().catch((error) => {
    invoiceSchemaPromise = null;
    throw error;
  });

  return invoiceSchemaPromise;
}

async function runInvoiceSchemaPatches(): Promise<void> {
  await ensureRateSetInvoiceSchema();

  await sql`
    CREATE TABLE IF NOT EXISTS invoice (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES client (id),
      provider_id INTEGER NOT NULL REFERENCES provider (id),
      status TEXT NOT NULL DEFAULT 'drafted',
      invoice_number TEXT NOT NULL,
      invoice_date TIMESTAMPTZ NOT NULL,
      amount NUMERIC(14, 4) NULL,
      expected_amount NUMERIC(14, 4) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ NULL
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS invoice_deleted_at_idx ON invoice (deleted_at)
      WHERE deleted_at IS NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS invoice_provider_number_active_uidx
    ON invoice (provider_id, lower(trim(invoice_number)))
    WHERE deleted_at IS NULL
  `.execute(db);

  await sql`
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
    )
  `.execute(db);

  await sql`
    ALTER TABLE invoice_item
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS invoice_item_invoice_id_idx ON invoice_item (invoice_id)
  `.execute(db);
}

function escapeLikePattern(fragment: string): string {
  return fragment.replaceAll(/[%_\\]/g, String.raw`\$&`);
}

function invoiceListWhereClause(filters: InvoiceListFilters) {
  const parts = [sql`i.deleted_at IS NULL`];

  if (filters.invoiceNumberSearch !== "") {
    const pattern = `%${escapeLikePattern(filters.invoiceNumberSearch)}%`;
    parts.push(sql`i.invoice_number ILIKE ${pattern} ESCAPE '\\'`);
  }

  if (filters.clientId !== null) {
    parts.push(sql`i.client_id = ${filters.clientId}`);
  }

  if (filters.providerId !== null) {
    parts.push(sql`i.provider_id = ${filters.providerId}`);
  }

  if (filters.invoiceDate !== null) {
    parts.push(
      sql`(i.invoice_date AT TIME ZONE 'UTC')::date = ${filters.invoiceDate}::date`,
    );
  }

  return sql.join(parts, sql` AND `);
}

export async function countInvoiceRows(
  filters: InvoiceListFilters,
): Promise<number> {
  await ensureInvoiceSchema();
  const whereClause = invoiceListWhereClause(filters);

  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM invoice i
    INNER JOIN client c ON c.id = i.client_id AND c.deleted_at IS NULL
    INNER JOIN provider p ON p.id = i.provider_id AND p.deleted_at IS NULL
    WHERE ${whereClause}
  `.execute(db);

  const raw = result.rows[0]?.count ?? "0";
  const total = Number.parseInt(raw, 10);

  return Number.isFinite(total) ? total : 0;
}

export async function listInvoiceRows(
  filters: InvoiceListFilters,
): Promise<InvoiceListRow[]> {
  await ensureInvoiceSchema();
  const whereClause = invoiceListWhereClause(filters);
  const limit = filters.limit;
  const offset = filters.offset;

  const result = await sql<InvoiceListRow>`
    SELECT
      i.id,
      i.client_id,
      i.provider_id,
      i.status,
      i.invoice_number,
      i.invoice_date::text AS invoice_date,
      i.amount::text AS amount,
      i.expected_amount::text AS expected_amount,
      i.created_at::text AS created_at,
      i.updated_at::text AS updated_at,
      i.deleted_at::text AS deleted_at,
      trim(c.first_name) || ' ' || trim(c.last_name) || ' (' || c.ndis_number || ')' AS client_label,
      trim(p.name) || ' (' || p.abn || ')' AS provider_label
    FROM invoice i
    INNER JOIN client c ON c.id = i.client_id AND c.deleted_at IS NULL
    INNER JOIN provider p ON p.id = i.provider_id AND p.deleted_at IS NULL
    WHERE ${whereClause}
    ORDER BY i.invoice_date DESC, i.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `.execute(db);

  return result.rows;
}

export async function softDeleteInvoiceRow(
  invoiceId: number,
): Promise<{ id: number; deleted_at: string } | undefined> {
  await ensureInvoiceSchema();

  const result = await sql<{ id: number; deleted_at: string }>`
    UPDATE invoice
    SET
      deleted_at = now(),
      updated_at = now()
    WHERE id = ${invoiceId}
      AND deleted_at IS NULL
    RETURNING id, deleted_at::text AS deleted_at
  `.execute(db);

  return result.rows[0];
}

export type InvoiceItemInsertRow = {
  rateSetId: number | null;
  categoryId: number | null;
  supportItemId: number | null;
  startDateIso: string | null;
  endDateIso: string | null;
  maxRate: string | null;
  unit: string | null;
  inputRate: string | null;
  amount: string | null;
  sortOrder: number;
};

export async function invoiceNumberExistsForProvider(
  providerId: number,
  invoiceNumber: string,
  excludeInvoiceId?: number | null,
): Promise<boolean> {
  await ensureInvoiceSchema();
  const normalized = invoiceNumber.trim();
  const excludeClause =
    excludeInvoiceId === undefined || excludeInvoiceId === null
      ? sql``
      : sql`AND i.id <> ${excludeInvoiceId}`;

  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM invoice i
      WHERE i.provider_id = ${providerId}
        AND i.deleted_at IS NULL
        AND lower(trim(i.invoice_number)) = lower(${normalized})
        ${excludeClause}
    ) AS exists
  `.execute(db);

  return result.rows[0]?.exists ?? false;
}

export async function createInvoiceWithItems(input: {
  clientId: number;
  providerId: number;
  invoiceNumber: string;
  invoiceDateIso: string;
  expectedAmount: string;
  amount: string | null;
  status: string;
  items: InvoiceItemInsertRow[];
}): Promise<number> {
  await ensureInvoiceSchema();

  return db.transaction().execute(async (trx) => {
    const inv = await sql<{ id: number }>`
      INSERT INTO invoice (
        client_id,
        provider_id,
        status,
        invoice_number,
        invoice_date,
        amount,
        expected_amount
      )
      VALUES (
        ${input.clientId},
        ${input.providerId},
        ${input.status},
        ${input.invoiceNumber.trim()},
        ${input.invoiceDateIso}::timestamptz,
        ${input.amount},
        ${input.expectedAmount}
      )
      RETURNING id
    `.execute(trx);

    const invoiceId = inv.rows[0]?.id;

    if (invoiceId === undefined) {
      throw new Error("Invoice insert returned no id.");
    }

    for (const it of input.items) {
      await sql`
        INSERT INTO invoice_item (
          invoice_id,
          rate_set_id,
          category_id,
          support_item_id,
          start_date,
          end_date,
          max_rate,
          unit,
          input_rate,
          amount,
          sort_order
        )
        VALUES (
          ${invoiceId},
          ${it.rateSetId},
          ${it.categoryId},
          ${it.supportItemId},
          ${it.startDateIso}::timestamptz,
          ${it.endDateIso}::timestamptz,
          ${it.maxRate},
          ${it.unit},
          ${it.inputRate},
          ${it.amount},
          ${it.sortOrder}
        )
      `.execute(trx);
    }

    return invoiceId;
  });
}

export async function updateInvoiceWithItems(input: {
  invoiceId: number;
  clientId: number;
  providerId: number;
  invoiceNumber: string;
  invoiceDateIso: string;
  expectedAmount: string;
  amount: string | null;
  status: string;
  items: InvoiceItemInsertRow[];
}): Promise<void> {
  await ensureInvoiceSchema();

  await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE invoice
      SET
        client_id = ${input.clientId},
        provider_id = ${input.providerId},
        status = ${input.status},
        invoice_number = ${input.invoiceNumber.trim()},
        invoice_date = ${input.invoiceDateIso}::timestamptz,
        amount = ${input.amount},
        expected_amount = ${input.expectedAmount},
        updated_at = now()
      WHERE id = ${input.invoiceId}
        AND deleted_at IS NULL
    `.execute(trx);

    await sql`
      DELETE FROM invoice_item
      WHERE invoice_id = ${input.invoiceId}
    `.execute(trx);

    for (const it of input.items) {
      await sql`
        INSERT INTO invoice_item (
          invoice_id,
          rate_set_id,
          category_id,
          support_item_id,
          start_date,
          end_date,
          max_rate,
          unit,
          input_rate,
          amount,
          sort_order
        )
        VALUES (
          ${input.invoiceId},
          ${it.rateSetId},
          ${it.categoryId},
          ${it.supportItemId},
          ${it.startDateIso}::timestamptz,
          ${it.endDateIso}::timestamptz,
          ${it.maxRate},
          ${it.unit},
          ${it.inputRate},
          ${it.amount},
          ${it.sortOrder}
        )
      `.execute(trx);
    }
  });
}

export async function getInvoiceListRowById(
  invoiceId: number,
): Promise<InvoiceListRow | undefined> {
  await ensureInvoiceSchema();

  const result = await sql<InvoiceListRow>`
    SELECT
      i.id,
      i.client_id,
      i.provider_id,
      i.status,
      i.invoice_number,
      i.invoice_date::text AS invoice_date,
      i.amount::text AS amount,
      i.expected_amount::text AS expected_amount,
      i.created_at::text AS created_at,
      i.updated_at::text AS updated_at,
      i.deleted_at::text AS deleted_at,
      trim(c.first_name) || ' ' || trim(c.last_name) || ' (' || c.ndis_number || ')' AS client_label,
      trim(p.name) || ' (' || p.abn || ')' AS provider_label
    FROM invoice i
    INNER JOIN client c ON c.id = i.client_id AND c.deleted_at IS NULL
    INNER JOIN provider p ON p.id = i.provider_id AND p.deleted_at IS NULL
    WHERE i.id = ${invoiceId}
      AND i.deleted_at IS NULL
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

export async function listInvoiceItemRowsByInvoiceId(
  invoiceId: number,
): Promise<InvoiceItemRow[]> {
  await ensureInvoiceSchema();

  const result = await sql<InvoiceItemRow>`
    SELECT
      ii.id,
      ii.invoice_id,
      ii.rate_set_id,
      ii.category_id,
      ii.support_item_id,
      (ii.start_date AT TIME ZONE 'UTC')::date::text AS start_date,
      (ii.end_date AT TIME ZONE 'UTC')::date::text AS end_date,
      ii.max_rate::text AS max_rate,
      ii.unit::text AS unit,
      ii.input_rate::text AS input_rate,
      ii.amount::text AS amount,
      ii.sort_order
    FROM invoice_item ii
    INNER JOIN invoice i ON i.id = ii.invoice_id
    WHERE ii.invoice_id = ${invoiceId}
      AND i.deleted_at IS NULL
    ORDER BY ii.sort_order ASC, ii.id ASC
  `.execute(db);

  return result.rows;
}
