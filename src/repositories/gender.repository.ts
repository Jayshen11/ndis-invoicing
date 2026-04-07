import { sql } from "kysely";
import { db } from "@/db/client";
import type {
  CreateGenderInput,
  GenderCreateRowInput,
  GenderListFilters,
  GenderRow,
} from "@/modules/gender/types";

function getSearchPattern(search: string): string {
  const escapeReplacement = String.raw`\$&`;
  const escapedSearch = search.replaceAll(/[%_\\]/g, escapeReplacement);

  return `%${escapedSearch}%`;
}

function getStatusPredicate(status: GenderListFilters["status"]) {
  if (status === "active") {
    return sql`g.deactivated_at is null`;
  }

  if (status === "inactive") {
    return sql`g.deactivated_at is not null`;
  }

  return sql`1 = 1`;
}

function genderListWhereClause(filters: GenderListFilters) {
  const searchPattern = getSearchPattern(filters.search);
  const statusPredicate = getStatusPredicate(filters.status);

  return sql`
    ${statusPredicate}
      and (
        ${filters.search} = ''
        or g.label ilike ${searchPattern} escape '\'
        or g.code ilike ${searchPattern} escape '\'
      )
  `;
}

export async function countGenderRows(filters: GenderListFilters): Promise<number> {
  const whereClause = genderListWhereClause(filters);

  const result = await sql<{ count: string }>`
    select count(*)::text as count
    from gender g
    where ${whereClause}
  `.execute(db);

  const raw = result.rows[0]?.count ?? "0";
  const total = Number.parseInt(raw, 10);

  return Number.isFinite(total) ? total : 0;
}

export async function listGenderRows(
  filters: GenderListFilters,
): Promise<GenderRow[]> {
  const whereClause = genderListWhereClause(filters);
  const limit = filters.limit;
  const offset = filters.offset;

  const result = await sql<GenderRow>`
    select
      g.id,
      g.code,
      g.label,
      g.created_at::text as created_at,
      g.updated_at::text as updated_at,
      g.deactivated_at::text as deactivated_at
    from gender g
    where ${whereClause}
    order by lower(g.label) asc, g.id asc
    limit ${limit}
    offset ${offset}
  `.execute(db);

  return result.rows;
}

/** Existing row with same code ignoring case, if any (unique on `code` enforces this in DB). */
export async function findConflictingGenderIdByCodeCaseInsensitive(
  code: string,
  excludeGenderId?: number,
): Promise<number | undefined> {
  const trimmed = code.trim();

  const result =
    excludeGenderId === undefined
      ? await sql<{ id: number }>`
          select id
          from gender
          where lower(code) = lower(${trimmed})
          limit 1
        `.execute(db)
      : await sql<{ id: number }>`
          select id
          from gender
          where id <> ${excludeGenderId}
            and lower(code) = lower(${trimmed})
          limit 1
        `.execute(db);

  return result.rows[0]?.id;
}

export async function getGenderRowById(
  genderId: number,
): Promise<GenderRow | undefined> {
  const result = await sql<GenderRow>`
    select
      g.id,
      g.code,
      g.label,
      g.created_at::text as created_at,
      g.updated_at::text as updated_at,
      g.deactivated_at::text as deactivated_at
    from gender g
    where g.id = ${genderId}
    limit 1
  `.execute(db);

  return result.rows[0];
}

export async function insertGenderRow(
  input: GenderCreateRowInput,
): Promise<GenderRow> {
  const result = await sql<GenderRow>`
    insert into gender (
      code,
      label,
      deactivated_at
    )
    values (
      ${input.code},
      ${input.label},
      ${input.deactivated_at}
    )
    returning
      id,
      code,
      label,
      created_at::text as created_at,
      updated_at::text as updated_at,
      deactivated_at::text as deactivated_at
  `.execute(db);

  const createdGender = result.rows[0];

  if (!createdGender) {
    throw new Error("Gender insert returned no rows.");
  }

  return createdGender;
}

export async function updateGenderRow(
  genderId: number,
  input: CreateGenderInput,
): Promise<GenderRow | undefined> {
  const result = await sql<GenderRow>`
    update gender
    set
      code = ${input.code},
      label = ${input.label},
      updated_at = now(),
      deactivated_at = case
        when ${input.active} then null
        else coalesce(deactivated_at, now())
      end
    where id = ${genderId}
    returning
      id,
      code,
      label,
      created_at::text as created_at,
      updated_at::text as updated_at,
      deactivated_at::text as deactivated_at
  `.execute(db);

  return result.rows[0];
}

export async function markGenderRowDeleted(
  genderId: number,
): Promise<GenderRow | undefined> {
  const result = await sql<GenderRow>`
    update gender
    set
      deactivated_at = coalesce(deactivated_at, now()),
      updated_at = now()
    where id = ${genderId}
      and deactivated_at is null
    returning
      id,
      code,
      label,
      created_at::text as created_at,
      updated_at::text as updated_at,
      deactivated_at::text as deactivated_at
  `.execute(db);

  return result.rows[0];
}
