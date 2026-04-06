import { sql } from "kysely";
import { db } from "@/db/client";
import type {
  CreateProviderInput,
  ProviderApiRecord,
  ProviderListFilters,
} from "@/modules/provider/types";

let providerSchemaPromise: Promise<void> | null = null;

export async function ensureProviderSchema(): Promise<void> {
  if (process.env.RBAC_SKIP_DDL === "1") {
    return;
  }

  if (providerSchemaPromise === null) {
    providerSchemaPromise = runProviderSchemaPatches().catch((error) => {
      providerSchemaPromise = null;
      throw error;
    });
  }

  return providerSchemaPromise;
}

async function runProviderSchemaPatches(): Promise<void> {
  await sql`
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
    )
  `.execute(db);

  await sql`
    ALTER TABLE provider
      ADD COLUMN IF NOT EXISTS phone_number TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE provider
      ADD COLUMN IF NOT EXISTS address TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE provider
      ADD COLUMN IF NOT EXISTS unit_building TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE provider
      ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL
  `.execute(db);

  await sql`
    ALTER TABLE provider
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
  `.execute(db);

  await sql`
    ALTER TABLE provider
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `.execute(db);

  await sql`
    ALTER TABLE provider
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `.execute(db);
}

function getSearchPattern(search: string): string {
  const escapeReplacement = String.raw`\$&`;
  const escapedSearch = search.replaceAll(/[%_\\]/g, escapeReplacement);

  return `%${escapedSearch}%`;
}

function getStatusPredicate(status: ProviderListFilters["status"]) {
  if (status === "active") {
    return sql`p.deactivated_at IS NULL`;
  }

  if (status === "inactive") {
    return sql`p.deactivated_at IS NOT NULL`;
  }

  return sql`TRUE`;
}

function providerListWhereClause(filters: ProviderListFilters) {
  const statusPredicate = getStatusPredicate(filters.status);
  const searchPattern = getSearchPattern(filters.search);

  return sql`
    p.deleted_at IS NULL
      AND ${statusPredicate}
      AND (
        ${filters.search} = ''
        OR p.abn ILIKE ${searchPattern} ESCAPE '\'
        OR p.name ILIKE ${searchPattern} ESCAPE '\'
        OR p.email ILIKE ${searchPattern} ESCAPE '\'
      )
  `;
}

function insertDeactivatedAt(active: boolean) {
  return active ? sql`NULL` : sql`now()`;
}

function updateDeactivatedAt(active: boolean) {
  return active ? sql`NULL` : sql`COALESCE(deactivated_at, now())`;
}

export async function countProviderRows(
  filters: ProviderListFilters,
): Promise<number> {
  await ensureProviderSchema();
  const whereClause = providerListWhereClause(filters);

  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM provider p
    WHERE ${whereClause}
  `.execute(db);

  const raw = result.rows[0]?.count ?? "0";
  const total = Number.parseInt(raw, 10);

  return Number.isFinite(total) ? total : 0;
}

export async function listProviderRows(
  filters: ProviderListFilters,
): Promise<ProviderApiRecord[]> {
  await ensureProviderSchema();
  const whereClause = providerListWhereClause(filters);
  const limit = filters.limit;
  const offset = filters.offset;

  const result = await sql<ProviderApiRecord>`
    SELECT
      p.id,
      p.abn,
      p.name,
      p.email,
      p.phone_number,
      p.address,
      p.unit_building,
      p.created_at::text AS created_at,
      p.updated_at::text AS updated_at,
      p.deactivated_at::text AS deactivated_at,
      p.deleted_at::text AS deleted_at
    FROM provider p
    WHERE ${whereClause}
    ORDER BY lower(p.name) ASC, p.id ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `.execute(db);

  return result.rows;
}

export async function getProviderRowById(
  providerId: number,
): Promise<ProviderApiRecord | undefined> {
  await ensureProviderSchema();

  const result = await sql<ProviderApiRecord>`
    SELECT
      p.id,
      p.abn,
      p.name,
      p.email,
      p.phone_number,
      p.address,
      p.unit_building,
      p.created_at::text AS created_at,
      p.updated_at::text AS updated_at,
      p.deactivated_at::text AS deactivated_at,
      p.deleted_at::text AS deleted_at
    FROM provider p
    WHERE p.id = ${providerId}
      AND p.deleted_at IS NULL
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

export async function insertProviderRow(
  input: CreateProviderInput,
): Promise<ProviderApiRecord> {
  await ensureProviderSchema();

  const deactivatedAt = insertDeactivatedAt(input.active);

  const result = await sql<ProviderApiRecord>`
    INSERT INTO provider (
      abn,
      name,
      email,
      phone_number,
      address,
      unit_building,
      deactivated_at
    )
    VALUES (
      ${input.abn},
      ${input.name},
      ${input.email},
      ${input.phone_number},
      ${input.address},
      ${input.unit_building},
      ${deactivatedAt}
    )
    RETURNING
      id,
      abn,
      name,
      email,
      phone_number,
      address,
      unit_building,
      created_at::text AS created_at,
      updated_at::text AS updated_at,
      deactivated_at::text AS deactivated_at,
      deleted_at::text AS deleted_at
  `.execute(db);

  const row = result.rows[0];
  if (!row) {
    throw new Error("Provider insert returned no rows.");
  }

  return row;
}

export async function updateProviderRow(
  providerId: number,
  input: CreateProviderInput,
): Promise<ProviderApiRecord | undefined> {
  await ensureProviderSchema();

  const deactivatedAt = updateDeactivatedAt(input.active);

  const result = await sql<{ id: number }>`
    UPDATE provider
    SET
      abn = ${input.abn},
      name = ${input.name},
      email = ${input.email},
      phone_number = ${input.phone_number},
      address = ${input.address},
      unit_building = ${input.unit_building},
      updated_at = now(),
      deactivated_at = ${deactivatedAt}
    WHERE id = ${providerId}
      AND deleted_at IS NULL
    RETURNING id
  `.execute(db);

  if (!result.rows[0]) {
    return undefined;
  }

  return getProviderRowById(providerId);
}

export type ProviderOptionRow = {
  id: number;
  label: string;
};

/** SEC: Options for filters; only id + display label. */
export async function listProviderOptionRows(): Promise<ProviderOptionRow[]> {
  await ensureProviderSchema();

  const result = await sql<ProviderOptionRow>`
    SELECT
      p.id,
      trim(p.name) || ' (' || p.abn || ')' AS label
    FROM provider p
    WHERE p.deleted_at IS NULL
      AND p.deactivated_at IS NULL
    ORDER BY lower(p.name) ASC, p.id ASC
  `.execute(db);

  return result.rows;
}

export async function softDeleteProviderRow(
  providerId: number,
): Promise<{ id: number; deleted_at: string } | undefined> {
  await ensureProviderSchema();

  const result = await sql<{ id: number; deleted_at: string }>`
    UPDATE provider
    SET
      deleted_at = now(),
      updated_at = now()
    WHERE id = ${providerId}
      AND deleted_at IS NULL
    RETURNING id, deleted_at::text AS deleted_at
  `.execute(db);

  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  return { id: row.id, deleted_at: row.deleted_at };
}
