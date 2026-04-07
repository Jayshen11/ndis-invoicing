import { sql } from "kysely";
import { db } from "@/db/client";
import { RBAC_PERMISSION_SEEDS } from "@/modules/user-role/permissions-catalog";
import type {
  CreateUserRoleInput,
  RbacRoleOptionRow,
  UserRoleCreateRowInput,
  UserRoleListFilters,
  UserRoleListRow,
  UserRoleRow,
} from "@/modules/user-role/types";

/** Resolved once per process. Override with RBAC_ROLE_TABLE=rbac_role|user_role if needed. */
type RbacRoleTableName = "rbac_role" | "user_role";

let rbacTableCache: RbacRoleTableName | undefined;
let rbacTablePromise: Promise<RbacRoleTableName> | null = null;

let rbacSchemaPatchPromise: Promise<void> | null = null;

/**
 * SEC: Effective permission **codes** come only from `rbac_user_role_permission` (+ `rbac_permission`).
 * Do not fall back to legacy `rbac_role.permissions` JSON — that column is easy to leave stale and
 * would grant slugs the junction no longer assigns (breaks `/api/auth/me` and session RBAC).
 */
const rolePermissionsJsonSelect = sql`
  (
    select coalesce(json_agg(p.code order by p.code)::text, '[]')
    from rbac_user_role_permission rup
    inner join rbac_permission p on p.id = rup.permission_id
    where rup.role_id = r.id
  )
`;

/** Same as {@link rolePermissionsJsonSelect} for `UPDATE ... RETURNING` (bare column names). */
const rolePermissionsJsonReturning = sql`
  (
    select coalesce(json_agg(p.code order by p.code)::text, '[]')
    from rbac_user_role_permission rup
    inner join rbac_permission p on p.id = rup.permission_id
    where rup.role_id = id
  )
`;

const rolePermissionIdsSelect = sql`
  (
    select coalesce(json_agg(rup.permission_id order by rup.permission_id)::text, '[]')
    from rbac_user_role_permission rup
    where rup.role_id = r.id
  )
`;

const rolePermissionIdsReturning = sql`
  (
    select coalesce(json_agg(rup.permission_id order by rup.permission_id)::text, '[]')
    from rbac_user_role_permission rup
    where rup.role_id = id
  )
`;

/**
 * Ensures RBAC DDL needed for API queries: role columns, `rbac_permission`, junction.
 *
 * - **Always** runs structural patches (unless `RBAC_SKIP_DDL=1`), so list routes do not
 *   fail with missing `permissions` / junction tables.
 * - Gateway-aligned **seeds** run unless `RBAC_SKIP_SCHEMA_PATCH=1` (faster CI, or DB-owned data).
 */
export async function ensureRbacRoleSchemaPatches(): Promise<void> {
  // SEC: Opt-out for environments where the app must not run DDL (e.g. locked-down tests).
  if (process.env.RBAC_SKIP_DDL === "1") {
    return;
  }

  if (rbacSchemaPatchPromise === null) {
    rbacSchemaPatchPromise = runRbacRoleSchemaPatches().catch((error) => {
      rbacSchemaPatchPromise = null;
      throw error;
    });
  }

  return rbacSchemaPatchPromise;
}

async function applyRbacStructuralSchemaPatches(): Promise<void> {
  // List/count queries expect these columns; legacy or gateway-minimal tables may omit some.
  await sql`
    ALTER TABLE IF EXISTS rbac_role
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS rbac_role
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS rbac_role
      ADD COLUMN IF NOT EXISTS deactivated_at timestamptz NULL
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS rbac_role
      ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS rbac_role
      ADD COLUMN IF NOT EXISTS permissions text NOT NULL DEFAULT '[]'
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS rbac_role
      ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS user_role
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS user_role
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS user_role
      ADD COLUMN IF NOT EXISTS deactivated_at timestamptz NULL
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS user_role
      ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS user_role
      ADD COLUMN IF NOT EXISTS permissions text NOT NULL DEFAULT '[]'
  `.execute(db);

  await sql`
    ALTER TABLE IF EXISTS user_role
      ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS rbac_permission (
      id integer NOT NULL PRIMARY KEY,
      code text NOT NULL UNIQUE,
      label text NOT NULL,
      created_at timestamptz NOT NULL default now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS rbac_user_role_permission (
      role_id integer NOT NULL,
      permission_id integer NOT NULL REFERENCES rbac_permission (id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_rbac_user_role_permission_permission_id
      ON rbac_user_role_permission (permission_id)
  `.execute(db);
}

async function seedRbacPermissionTable(): Promise<void> {
  let insertWithOverridingSystemValue = false;

  for (const row of RBAC_PERMISSION_SEEDS) {
    const runInsert = (useOverriding: boolean) =>
      useOverriding
        ? sql`
            INSERT INTO rbac_permission (id, code, label, created_at)
            OVERRIDING SYSTEM VALUE
            VALUES (
              ${row.id},
              ${row.code},
              ${row.label},
              ${row.created_at}::timestamptz
            )
            ON CONFLICT (code) DO UPDATE SET
              label = excluded.label
          `.execute(db)
        : sql`
            INSERT INTO rbac_permission (id, code, label, created_at)
            VALUES (
              ${row.id},
              ${row.code},
              ${row.label},
              ${row.created_at}::timestamptz
            )
            ON CONFLICT (code) DO UPDATE SET
              label = excluded.label
          `.execute(db);

    try {
      await runInsert(insertWithOverridingSystemValue);
    } catch (error) {
      const code = getPgErrorCode(error);
      if (code === "428C9" && !insertWithOverridingSystemValue) {
        insertWithOverridingSystemValue = true;
        await runInsert(true);
      } else {
        throw error;
      }
    }
  }

  await sql`
    DO $$
    BEGIN
      IF pg_get_serial_sequence('rbac_permission', 'id') IS NOT NULL THEN
        PERFORM setval(
          pg_get_serial_sequence('rbac_permission', 'id'),
          (SELECT coalesce(max(id), 1) FROM rbac_permission)
        );
      END IF;
    END $$;
  `.execute(db);
}

async function runRbacRoleSchemaPatches(): Promise<void> {
  await applyRbacStructuralSchemaPatches();

  if (process.env.RBAC_SKIP_SCHEMA_PATCH === "1") {
    return;
  }

  await seedRbacPermissionTable();
}

function getPgErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }

  if (error instanceof Error && error.cause !== undefined) {
    return getPgErrorCode(error.cause);
  }

  return undefined;
}

type TransactionDb = typeof db;

async function replaceRolePermissionsForRole(
  trx: TransactionDb,
  roleId: number,
  permissionCodes: readonly string[],
): Promise<void> {
  const codes = [...new Set(permissionCodes)];

  await sql`
    DELETE FROM rbac_user_role_permission
    WHERE role_id = ${roleId}
  `.execute(trx);

  for (const code of codes) {
    const inserted = await sql`
      INSERT INTO rbac_user_role_permission (role_id, permission_id)
      SELECT ${roleId}, p.id
      FROM rbac_permission p
      WHERE p.code = ${code}
      ON CONFLICT DO NOTHING
      RETURNING role_id
    `.execute(trx);

    if (!inserted.rows[0]) {
      throw new Error(`Unknown or duplicate permission code for junction: ${code}`);
    }
  }
}

export async function resolveRbacRoleTableName(): Promise<RbacRoleTableName> {
  await ensureRbacRoleSchemaPatches();

  const fromEnv = process.env.RBAC_ROLE_TABLE?.trim();
  if (fromEnv === "rbac_role" || fromEnv === "user_role") {
    rbacTableCache = fromEnv;
    return fromEnv;
  }

  if (rbacTableCache !== undefined) {
    return rbacTableCache;
  }

  if (rbacTablePromise) {
    return rbacTablePromise;
  }

  rbacTablePromise = (async () => {
    const result = await sql<{ table_name: string }>`
      select table_name::text
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('rbac_role', 'user_role')
    `.execute(db);

    const names = new Set(result.rows.map((row) => row.table_name));
    if (names.has("rbac_role")) {
      return "rbac_role";
    }
    if (names.has("user_role")) {
      return "user_role";
    }

    throw new Error(
      "RBAC role table not found: start the app with RBAC_SKIP_DDL unset so patches run, create public.rbac_role manually, or set RBAC_ROLE_TABLE.",
    );
  })();

  try {
    rbacTableCache = await rbacTablePromise;
    return rbacTableCache;
  } finally {
    rbacTablePromise = null;
  }
}

/** Label for a role id (e.g. audit log actor attribution). */
export async function getRbacRoleLabelById(
  roleId: number,
): Promise<string | null> {
  await ensureRbacRoleSchemaPatches();
  const table = await resolveRbacRoleTableName();

  const result = await sql<{ label: string }>`
    select r.label
    from ${sql.table(table)} r
    where r.id = ${roleId}
    limit 1
  `.execute(db);

  return result.rows[0]?.label ?? null;
}

type UserRoleDbRow = Omit<UserRoleRow, "permissions" | "permission_ids"> & {
  permissions: string | null;
  permission_ids: string | null;
};

function parsePermissionsJson(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parsePermissionIdsJson(raw: string | null | undefined): number[] {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (item): item is number =>
        typeof item === "number" && Number.isInteger(item),
    );
  } catch {
    return [];
  }
}

function toUserRoleRow(row: UserRoleDbRow): UserRoleRow {
  return {
    ...row,
    permissions: parsePermissionsJson(row.permissions),
    permission_ids: parsePermissionIdsJson(row.permission_ids),
  };
}

function getSearchPattern(search: string): string {
  const escapeReplacement = String.raw`\$&`;
  const escapedSearch = search.replaceAll(/[%_\\]/g, escapeReplacement);

  return `%${escapedSearch}%`;
}

function getStatusPredicate(status: UserRoleListFilters["status"]) {
  if (status === "active") {
    return sql`r.deactivated_at is null`;
  }

  if (status === "inactive") {
    return sql`r.deactivated_at is not null`;
  }

  return sql`1 = 1`;
}

function userRoleListWhereClause(filters: UserRoleListFilters) {
  const searchPattern = getSearchPattern(filters.search);
  const statusPredicate = getStatusPredicate(filters.status);

  return sql`
    coalesce(r.is_deleted, false) = false
      and ${statusPredicate}
      and (
        ${filters.search} = ''
        or r.label ilike ${searchPattern} escape '\'
        or r.code ilike ${searchPattern} escape '\'
      )
  `;
}

export async function countUserRoleRows(
  filters: UserRoleListFilters,
): Promise<number> {
  const table = await resolveRbacRoleTableName();
  const whereClause = userRoleListWhereClause(filters);

  const result = await sql<{ count: string }>`
    select count(*)::text as count
    from ${sql.table(table)} as r
    where ${whereClause}
  `.execute(db);

  const raw = result.rows[0]?.count ?? "0";
  const total = Number.parseInt(raw, 10);

  return Number.isFinite(total) ? total : 0;
}

export async function listUserRoleRows(
  filters: UserRoleListFilters,
): Promise<UserRoleListRow[]> {
  const table = await resolveRbacRoleTableName();
  const whereClause = userRoleListWhereClause(filters);
  const limit = filters.limit;
  const offset = filters.offset;

  const result = await sql<UserRoleListRow>`
    select
      r.id,
      r.code,
      r.label,
      r.created_at::text as created_at,
      r.updated_at::text as updated_at,
      r.deactivated_at::text as deactivated_at,
      coalesce(r.is_deleted, false) as is_deleted,
      coalesce(r.is_default, false) as is_default
    from ${sql.table(table)} as r
    where ${whereClause}
    order by lower(r.label) asc, r.id asc
    limit ${limit}
    offset ${offset}
  `.execute(db);

  return result.rows;
}

export async function findConflictingUserRoleIdByCodeCaseInsensitive(
  code: string,
  excludeUserRoleId?: number,
): Promise<number | undefined> {
  const table = await resolveRbacRoleTableName();
  const trimmed = code.trim();

  const result =
    excludeUserRoleId === undefined
      ? await sql<{ id: number }>`
          select id
          from ${sql.table(table)}
          where coalesce(is_deleted, false) = false
            and lower(code) = lower(${trimmed})
          limit 1
        `.execute(db)
      : await sql<{ id: number }>`
          select id
          from ${sql.table(table)}
          where coalesce(is_deleted, false) = false
            and id <> ${excludeUserRoleId}
            and lower(code) = lower(${trimmed})
          limit 1
        `.execute(db);

  return result.rows[0]?.id;
}

export async function getUserRoleRowById(
  userRoleId: number,
): Promise<UserRoleRow | undefined> {
  const table = await resolveRbacRoleTableName();
  const result = await sql<UserRoleDbRow>`
    select
      r.id,
      r.code,
      r.label,
      r.created_at::text as created_at,
      r.updated_at::text as updated_at,
      r.deactivated_at::text as deactivated_at,
      coalesce(r.is_deleted, false) as is_deleted,
      coalesce(r.is_default, false) as is_default,
      ${rolePermissionsJsonSelect} as permissions,
      ${rolePermissionIdsSelect} as permission_ids
    from ${sql.table(table)} as r
    where r.id = ${userRoleId}
      and coalesce(r.is_deleted, false) = false
    limit 1
  `.execute(db);

  const row = result.rows[0];
  return row ? toUserRoleRow(row) : undefined;
}

export async function insertUserRoleRow(
  input: UserRoleCreateRowInput,
): Promise<UserRoleRow> {
  const table = await resolveRbacRoleTableName();
  const permissionsJson = JSON.stringify(input.permissions);

  const newId = await db.transaction().execute(async (trx) => {
    const result = await sql<{ id: number }>`
      insert into ${sql.table(table)} (
        code,
        label,
        deactivated_at,
        is_deleted,
        is_default,
        permissions
      )
      values (
        ${input.code},
        ${input.label},
        ${input.deactivated_at},
        false,
        false,
        ${permissionsJson}
      )
      returning id
    `.execute(trx);

    const id = result.rows[0]?.id;
    if (!id) {
      throw new Error("User role insert returned no id.");
    }

    await replaceRolePermissionsForRole(trx, id, input.permissions);
    return id;
  });

  const row = await getUserRoleRowById(newId);
  if (!row) {
    throw new Error("User role insert could not be reloaded.");
  }

  return row;
}

export async function updateUserRoleRow(
  userRoleId: number,
  input: CreateUserRoleInput,
): Promise<UserRoleRow | undefined> {
  const table = await resolveRbacRoleTableName();
  const permissionsJson = JSON.stringify(input.permissions);

  const updated = await db.transaction().execute(async (trx) => {
    const result = await sql<{ id: number }>`
      update ${sql.table(table)}
      set
        code = ${input.code},
        label = ${input.label},
        permissions = ${permissionsJson},
        updated_at = now(),
        deactivated_at = case
          when ${input.active} then null
          else coalesce(deactivated_at, now())
        end
      where id = ${userRoleId}
        and coalesce(is_deleted, false) = false
      returning id
    `.execute(trx);

    if (!result.rows[0]) {
      return false;
    }

    await replaceRolePermissionsForRole(trx, userRoleId, input.permissions);
    return true;
  });

  if (!updated) {
    return undefined;
  }

  return getUserRoleRowById(userRoleId);
}

export async function markUserRoleRowDeleted(
  userRoleId: number,
): Promise<UserRoleRow | undefined> {
  const table = await resolveRbacRoleTableName();
  const result = await sql<UserRoleDbRow>`
    update ${sql.table(table)}
    set
      is_deleted = true,
      updated_at = now()
    where id = ${userRoleId}
      and coalesce(is_deleted, false) = false
    returning
      id,
      code,
      label,
      created_at::text as created_at,
      updated_at::text as updated_at,
      deactivated_at::text as deactivated_at,
      coalesce(is_deleted, false) as is_deleted,
      coalesce(is_default, false) as is_default,
      ${rolePermissionsJsonReturning} as permissions,
      ${rolePermissionIdsReturning} as permission_ids
  `.execute(db);

  const row = result.rows[0];
  return row ? toUserRoleRow(row) : undefined;
}

/** SEC: Hard cap for dropdown payloads (internal API only). */
const RBAC_ROLE_OPTIONS_MAX = 5000;

/** Compact rows for admin selects (`GET /api/rbac-roles/options`). */
export async function listRbacRoleOptionRows(): Promise<RbacRoleOptionRow[]> {
  await ensureRbacRoleSchemaPatches();
  const table = await resolveRbacRoleTableName();

  const result = await sql<RbacRoleOptionRow>`
    select
      r.id,
      r.label
    from ${sql.table(table)} r
    where coalesce(r.is_deleted, false) = false
    order by lower(r.label) asc, r.id asc
    limit ${RBAC_ROLE_OPTIONS_MAX}
  `.execute(db);

  return result.rows;
}
