import type { Kysely } from "kysely";
import { sql } from "kysely";
import { db } from "@/db/client";
import type { RateSetListFilters } from "@/modules/rate-set/types";
import { ensureRateSetInvoiceSchema } from "@/repositories/rate-set-invoice.repository";

export type RateSetDbRow = {
  id: number;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  created_at: Date;
  updated_at: Date;
  deactivated_at: Date | null;
  deleted_at: Date | null;
};

export type RateSetDateWindowRow = {
  id: number;
  name: string;
  start_date: string;
  end_date: string | null;
};

export type RateSetDbExecutor = Kysely<Record<string, Record<string, unknown>>>;

function escapeLikePattern(fragment: string): string {
  return fragment.replaceAll(/[%_\\]/g, String.raw`\$&`);
}

function rateSetListWhereClause(filters: RateSetListFilters) {
  const parts = [sql`rs.deleted_at IS NULL`];

  if (filters.search !== "") {
    const pattern = `%${escapeLikePattern(filters.search)}%`;
    parts.push(
      sql`(rs.name ILIKE ${pattern} ESCAPE '\\' OR (rs.description IS NOT NULL AND rs.description ILIKE ${pattern} ESCAPE '\\'))`,
    );
  }

  if (filters.periodStart !== null && filters.periodEnd !== null) {
    parts.push(
      sql`rs.start_date <= ${filters.periodEnd}::date AND (rs.end_date IS NULL OR rs.end_date >= ${filters.periodStart}::date)`,
    );
  }

  if (filters.activeOnly === true) {
    parts.push(sql`rs.deactivated_at IS NULL`);
  } else if (filters.activeOnly === false) {
    parts.push(sql`rs.deactivated_at IS NOT NULL`);
  }

  return sql.join(parts, sql` AND `);
}

export async function countRateSetRows(filters: RateSetListFilters): Promise<number> {
  await ensureRateSetInvoiceSchema();
  const whereClause = rateSetListWhereClause(filters);

  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM rate_set rs
    WHERE ${whereClause}
  `.execute(db);

  const raw = result.rows[0]?.count ?? "0";
  const n = Number.parseInt(raw, 10);

  return Number.isFinite(n) ? n : 0;
}

export async function listRateSetRows(
  filters: RateSetListFilters,
): Promise<RateSetDbRow[]> {
  await ensureRateSetInvoiceSchema();
  const whereClause = rateSetListWhereClause(filters);

  const result = await sql<{
    id: number;
    name: string;
    description: string | null;
    start_date: string;
    end_date: string | null;
    created_at: Date;
    updated_at: Date;
    deactivated_at: Date | null;
    deleted_at: Date | null;
  }>`
    SELECT
      rs.id,
      rs.name,
      rs.description,
      rs.start_date::text AS start_date,
      rs.end_date::text AS end_date,
      rs.created_at,
      rs.updated_at,
      rs.deactivated_at,
      rs.deleted_at
    FROM rate_set rs
    WHERE ${whereClause}
    ORDER BY rs.updated_at DESC, rs.id DESC
    LIMIT ${filters.limit}
    OFFSET ${filters.offset}
  `.execute(db);

  return result.rows;
}

export async function getRateSetRowById(
  id: number,
): Promise<RateSetDbRow | undefined> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<RateSetDbRow>`
    SELECT
      rs.id,
      rs.name,
      rs.description,
      rs.start_date::text AS start_date,
      rs.end_date::text AS end_date,
      rs.created_at,
      rs.updated_at,
      rs.deactivated_at,
      rs.deleted_at
    FROM rate_set rs
    WHERE rs.id = ${id}
      AND rs.deleted_at IS NULL
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

export async function listOverlappingRateSetWindowRows(params: {
  startDateYmd: string;
  endDateYmd: string | null;
  excludeId: number | null;
}): Promise<RateSetDateWindowRow[]> {
  await ensureRateSetInvoiceSchema();

  const whereParts = [sql`rs.deleted_at IS NULL`];

  if (params.excludeId !== null) {
    whereParts.push(sql`rs.id <> ${params.excludeId}`);
  }

  if (params.endDateYmd !== null) {
    whereParts.push(
      sql`(rs.start_date AT TIME ZONE 'UTC')::date <= ${params.endDateYmd}::date`,
    );
  }

  whereParts.push(
    sql`(
      rs.end_date IS NULL
      OR (rs.end_date AT TIME ZONE 'UTC')::date >= ${params.startDateYmd}::date
    )`,
  );

  const result = await sql<RateSetDateWindowRow>`
    SELECT
      rs.id,
      rs.name,
      ((rs.start_date AT TIME ZONE 'UTC')::date)::text AS start_date,
      ((rs.end_date AT TIME ZONE 'UTC')::date)::text AS end_date
    FROM rate_set rs
    WHERE ${sql.join(whereParts, sql` AND `)}
    ORDER BY
      (rs.start_date AT TIME ZONE 'UTC')::date ASC,
      coalesce((rs.end_date AT TIME ZONE 'UTC')::date, DATE '9999-12-31') ASC,
      rs.id ASC
  `.execute(db);

  return result.rows;
}

export async function getPreviousAdjacentRateSetWindowRow(params: {
  startDateYmd: string;
  excludeId: number | null;
}): Promise<RateSetDateWindowRow | undefined> {
  await ensureRateSetInvoiceSchema();

  const whereParts = [
    sql`rs.deleted_at IS NULL`,
    sql`rs.end_date IS NOT NULL`,
    sql`(rs.end_date AT TIME ZONE 'UTC')::date < ${params.startDateYmd}::date`,
  ];

  if (params.excludeId !== null) {
    whereParts.push(sql`rs.id <> ${params.excludeId}`);
  }

  const result = await sql<RateSetDateWindowRow>`
    SELECT
      rs.id,
      rs.name,
      ((rs.start_date AT TIME ZONE 'UTC')::date)::text AS start_date,
      ((rs.end_date AT TIME ZONE 'UTC')::date)::text AS end_date
    FROM rate_set rs
    WHERE ${sql.join(whereParts, sql` AND `)}
    ORDER BY
      (rs.end_date AT TIME ZONE 'UTC')::date DESC,
      (rs.start_date AT TIME ZONE 'UTC')::date DESC,
      rs.id DESC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

export async function getNextAdjacentRateSetWindowRow(params: {
  endDateYmd: string;
  excludeId: number | null;
}): Promise<RateSetDateWindowRow | undefined> {
  await ensureRateSetInvoiceSchema();

  const whereParts = [
    sql`rs.deleted_at IS NULL`,
    sql`(rs.start_date AT TIME ZONE 'UTC')::date > ${params.endDateYmd}::date`,
  ];

  if (params.excludeId !== null) {
    whereParts.push(sql`rs.id <> ${params.excludeId}`);
  }

  const result = await sql<RateSetDateWindowRow>`
    SELECT
      rs.id,
      rs.name,
      ((rs.start_date AT TIME ZONE 'UTC')::date)::text AS start_date,
      ((rs.end_date AT TIME ZONE 'UTC')::date)::text AS end_date
    FROM rate_set rs
    WHERE ${sql.join(whereParts, sql` AND `)}
    ORDER BY
      (rs.start_date AT TIME ZONE 'UTC')::date ASC,
      coalesce((rs.end_date AT TIME ZONE 'UTC')::date, DATE '9999-12-31') ASC,
      rs.id ASC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

export async function insertRateSetRow(params: {
  name: string;
  description: string | null;
  startDateYmd: string;
  endDateYmd: string | null;
  active: boolean;
}): Promise<RateSetDbRow> {
  await ensureRateSetInvoiceSchema();

  return insertRateSetRowWithExecutor(db, params);
}

export async function insertRateSetRowWithExecutor(
  executor: RateSetDbExecutor,
  params: {
    name: string;
    description: string | null;
    startDateYmd: string;
    endDateYmd: string | null;
    active: boolean;
  },
): Promise<RateSetDbRow> {

  const deactivatedAt = params.active ? null : new Date();
  const endTs =
    params.endDateYmd === null
      ? sql`NULL::timestamptz`
      : sql`${params.endDateYmd}::timestamp AT TIME ZONE 'UTC'`;

  const result = await sql<{
    id: number;
    name: string;
    description: string | null;
    start_date: string;
    end_date: string | null;
    created_at: Date;
    updated_at: Date;
    deactivated_at: Date | null;
    deleted_at: Date | null;
  }>`
    INSERT INTO rate_set (name, description, start_date, end_date, deactivated_at)
    VALUES (
      ${params.name},
      ${params.description},
      ${params.startDateYmd}::timestamp AT TIME ZONE 'UTC',
      ${endTs},
      ${deactivatedAt}
    )
    RETURNING
      id,
      name,
      description,
      start_date::text AS start_date,
      end_date::text AS end_date,
      created_at,
      updated_at,
      deactivated_at,
      deleted_at
  `.execute(executor);

  const row = result.rows[0];

  if (!row) {
    throw new Error("Rate set insert returned no row.");
  }

  return row;
}

export async function updateRateSetRow(params: {
  id: number;
  name: string;
  description: string | null;
  startDateYmd: string;
  endDateYmd: string | null;
  active: boolean;
}): Promise<RateSetDbRow | undefined> {
  await ensureRateSetInvoiceSchema();

  return updateRateSetRowWithExecutor(db, params);
}

export async function updateRateSetRowWithExecutor(
  executor: RateSetDbExecutor,
  params: {
    id: number;
    name: string;
    description: string | null;
    startDateYmd: string;
    endDateYmd: string | null;
    active: boolean;
  },
): Promise<RateSetDbRow | undefined> {

  const deactivatedAt = params.active ? null : new Date();
  const endTs =
    params.endDateYmd === null
      ? sql`NULL::timestamptz`
      : sql`${params.endDateYmd}::timestamp AT TIME ZONE 'UTC'`;

  const result = await sql<RateSetDbRow>`
    UPDATE rate_set
    SET
      name = ${params.name},
      description = ${params.description},
      start_date = ${params.startDateYmd}::timestamp AT TIME ZONE 'UTC',
      end_date = ${endTs},
      deactivated_at = ${deactivatedAt},
      updated_at = now()
    WHERE id = ${params.id}
      AND deleted_at IS NULL
    RETURNING
      id,
      name,
      description,
      start_date::text AS start_date,
      end_date::text AS end_date,
      created_at,
      updated_at,
      deactivated_at,
      deleted_at
  `.execute(executor);

  return result.rows[0];
}

/** SEC: Soft-delete only; id must be a resolved positive integer from the route. */
export async function softDeleteRateSetRow(
  id: number,
): Promise<{ id: number; deleted_at: string } | undefined> {
  await ensureRateSetInvoiceSchema();

  const result = await sql<{ id: number; deleted_at: string }>`
    UPDATE rate_set
    SET
      deleted_at = now(),
      updated_at = now()
    WHERE id = ${id}
      AND deleted_at IS NULL
    RETURNING id, deleted_at::text AS deleted_at
  `.execute(db);

  return result.rows[0];
}
