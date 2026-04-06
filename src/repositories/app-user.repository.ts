import { sql } from "kysely";
import { db } from "@/db/client";
import type {
  AppUserCreateRowInput,
  AppUserListFilters,
  AppUserOptionRow,
  AppUserRow,
  CreateAppUserInput,
} from "@/modules/app-user/types";
import {
  ensureRbacRoleSchemaPatches,
  resolveRbacRoleTableName,
} from "@/repositories/user-role.repository";

let appUserSchemaPromise: Promise<void> | null = null;

export async function ensureAppUserSchema(): Promise<void> {
  if (process.env.RBAC_SKIP_DDL === "1") {
    return;
  }

  if (appUserSchemaPromise === null) {
    appUserSchemaPromise = runAppUserSchemaPatches().catch((error) => {
      appUserSchemaPromise = null;
      throw error;
    });
  }

  return appUserSchemaPromise;
}

async function runAppUserSchemaPatches(): Promise<void> {
  await ensureRbacRoleSchemaPatches();

  await sql`
    CREATE TABLE IF NOT EXISTS app_user (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      deactivated_at TIMESTAMPTZ NULL,
      deleted_at TIMESTAMPTZ NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  // Thin / pre-migration app_user tables: add columns before partial index (avoids 42703 on list).
  await sql`
    ALTER TABLE app_user
      ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL
  `.execute(db);

  await sql`
    ALTER TABLE app_user
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
  `.execute(db);

  await sql`
    ALTER TABLE app_user
      ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE
  `.execute(db);

  await sql`
    ALTER TABLE app_user
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `.execute(db);

  await sql`
    ALTER TABLE app_user
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `.execute(db);

  // Legacy boolean soft-delete → deleted_at; drop is_deleted; rebuild email uniqueness index.
  await sql`
    DO $drop_app_user_is_deleted$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'app_user'
          AND column_name = 'is_deleted'
      ) THEN
        UPDATE app_user
        SET deleted_at = COALESCE(deleted_at, updated_at)
        WHERE is_deleted = TRUE;

        DROP INDEX IF EXISTS idx_app_user_email_lower;
        ALTER TABLE app_user DROP COLUMN is_deleted;
      END IF;
    END $drop_app_user_is_deleted$;
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email_lower
    ON app_user (lower(btrim(email)))
    WHERE deleted_at IS NULL
  `.execute(db);

  // SEC: Role assignment via junction (user_id → role_id); role table is rbac_role or user_role.
  await sql`
    CREATE TABLE IF NOT EXISTS rbac_user_role (
      user_id INTEGER NOT NULL PRIMARY KEY
        REFERENCES app_user (id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_rbac_user_role_role_id
    ON rbac_user_role (role_id)
  `.execute(db);

  await sql`
    DO $migrate_app_user_role_to_junction$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'app_user'
          AND column_name = 'role_id'
      ) THEN
        INSERT INTO rbac_user_role (user_id, role_id)
        SELECT u.id, u.role_id
        FROM app_user u
        WHERE u.role_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM rbac_user_role x WHERE x.user_id = u.id
          );

        ALTER TABLE app_user DROP COLUMN role_id;
      END IF;
    END $migrate_app_user_role_to_junction$;
  `.execute(db);

  // SEC: Credentials isolated from profile row; one row per app user.
  await sql`
    CREATE TABLE IF NOT EXISTS auth_password (
      user_id INTEGER NOT NULL PRIMARY KEY
        REFERENCES app_user (id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL,
      password_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  // One-time: if an old DB still has app_user.password_hash, copy then drop the column.
  await sql`
    DO $migrate_legacy_app_user_password$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'app_user'
          AND column_name = 'password_hash'
      ) THEN
        INSERT INTO auth_password (user_id, password_hash, password_updated_at)
        SELECT
          u.id,
          u.password_hash,
          COALESCE(u.updated_at, now())
        FROM app_user u
        WHERE u.password_hash IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM auth_password ap WHERE ap.user_id = u.id
          );
        ALTER TABLE app_user DROP COLUMN password_hash;
      END IF;
    END $migrate_legacy_app_user_password$;
  `.execute(db);

  const roleTable = await resolveRbacRoleTableName();

  await sql`
    WITH role_pick AS (
      SELECT r.id AS role_id
      FROM ${sql.table(roleTable)} AS r
      WHERE COALESCE(r.is_deleted, FALSE) = FALSE
        AND r.code = 'SUPER_ADMIN'
      LIMIT 1
    ),
    ins AS (
      INSERT INTO app_user (email, full_name, is_default)
      SELECT
        ${"admin@example.com"},
        ${"Default Super Admin"},
        TRUE
      FROM role_pick
      WHERE NOT EXISTS (
        SELECT 1
        FROM app_user u
        WHERE u.deleted_at IS NULL
          AND u.is_default = TRUE
      )
      RETURNING id
    )
    INSERT INTO rbac_user_role (user_id, role_id)
    SELECT ins.id, role_pick.role_id
    FROM ins
    CROSS JOIN role_pick
  `.execute(db);
}

/**
 * SEC: Resolves RBAC for `/api/auth/me` and login — explicit chain:
 * `app_user.id` → `rbac_user_role.role_id` → `rbac_user_role_permission.permission_id` → `rbac_permission.code`.
 * Does not use `auth_session.role_id` (can lag after role reassignment).
 */
export async function resolveAuthRbacForAppUserId(
  userId: number,
): Promise<{ roleId: number; permissionCodes: readonly string[] } | null> {
  await ensureAppUserSchema();
  const roleTable = await resolveRbacRoleTableName();

  const roleRow = await sql<{ role_id: number }>`
    SELECT bur.role_id
    FROM rbac_user_role bur
    INNER JOIN ${sql.table(roleTable)} r ON r.id = bur.role_id
    WHERE bur.user_id = ${userId}
      AND COALESCE(r.is_deleted, FALSE) = FALSE
    LIMIT 1
  `.execute(db);

  const roleId = roleRow.rows[0]?.role_id;

  if (roleId === undefined) {
    return null;
  }

  const permRows = await sql<{ code: string }>`
    SELECT p.code
    FROM rbac_user_role_permission rup
    INNER JOIN rbac_permission p ON p.id = rup.permission_id
    WHERE rup.role_id = ${roleId}
    ORDER BY p.code
  `.execute(db);

  return {
    roleId,
    permissionCodes: permRows.rows.map((row) => row.code),
  };
}

function getSearchPattern(search: string): string {
  const escapeReplacement = String.raw`\$&`;
  const escapedSearch = search.replaceAll(/[%_\\]/g, escapeReplacement);

  return `%${escapedSearch}%`;
}

function getStatusPredicate(status: AppUserListFilters["status"]) {
  if (status === "active") {
    return sql`u.deactivated_at is null`;
  }

  if (status === "inactive") {
    return sql`u.deactivated_at is not null`;
  }

  return sql`1 = 1`;
}

function appUserListWhereClause(filters: AppUserListFilters) {
  const searchPattern = getSearchPattern(filters.search);
  const statusPredicate = getStatusPredicate(filters.status);
  const rolePredicate =
    filters.role_id === undefined
      ? sql`1 = 1`
      : sql`bur.role_id = ${filters.role_id}`;

  return sql`
    u.deleted_at IS NULL
      AND ${statusPredicate}
      AND ${rolePredicate}
      AND (
        ${filters.search} = ''
        OR u.email ILIKE ${searchPattern} ESCAPE '\'
        OR u.full_name ILIKE ${searchPattern} ESCAPE '\'
      )
  `;
}

export async function countAppUserRows(
  filters: AppUserListFilters,
): Promise<number> {
  await ensureAppUserSchema();
  const roleTable = await resolveRbacRoleTableName();
  const whereClause = appUserListWhereClause(filters);

  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM app_user u
    INNER JOIN rbac_user_role AS bur ON bur.user_id = u.id
    INNER JOIN ${sql.table(roleTable)} AS r ON r.id = bur.role_id
    WHERE ${whereClause}
  `.execute(db);

  const raw = result.rows[0]?.count ?? "0";
  const total = Number.parseInt(raw, 10);

  return Number.isFinite(total) ? total : 0;
}

export async function listAppUserRows(
  filters: AppUserListFilters,
): Promise<AppUserRow[]> {
  await ensureAppUserSchema();
  const roleTable = await resolveRbacRoleTableName();
  const whereClause = appUserListWhereClause(filters);
  const limit = filters.limit;
  const offset = filters.offset;

  const result = await sql<AppUserRow>`
    SELECT
      u.id,
      u.email,
      u.full_name,
      bur.role_id,
      r.label AS role_label,
      u.created_at::text AS created_at,
      u.updated_at::text AS updated_at,
      u.deactivated_at::text AS deactivated_at,
      u.deleted_at::text AS deleted_at,
      COALESCE(u.is_default, FALSE) AS is_default
    FROM app_user u
    INNER JOIN rbac_user_role AS bur ON bur.user_id = u.id
    INNER JOIN ${sql.table(roleTable)} AS r ON r.id = bur.role_id
    WHERE ${whereClause}
    ORDER BY lower(u.full_name) ASC, u.id ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `.execute(db);

  return result.rows;
}

export async function getAppUserRowById(
  appUserId: number,
): Promise<AppUserRow | undefined> {
  await ensureAppUserSchema();
  const roleTable = await resolveRbacRoleTableName();

  const result = await sql<AppUserRow>`
    SELECT
      u.id,
      u.email,
      u.full_name,
      bur.role_id,
      r.label AS role_label,
      u.created_at::text AS created_at,
      u.updated_at::text AS updated_at,
      u.deactivated_at::text AS deactivated_at,
      u.deleted_at::text AS deleted_at,
      COALESCE(u.is_default, FALSE) AS is_default
    FROM app_user u
    INNER JOIN rbac_user_role AS bur ON bur.user_id = u.id
    INNER JOIN ${sql.table(roleTable)} AS r ON r.id = bur.role_id
    WHERE u.id = ${appUserId}
      AND u.deleted_at IS NULL
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

/** Row for password login (internal only; never returned to clients). */
export type AppUserLoginCredentialRow = {
  user_id: number;
  role_id: number;
  password_hash: string;
};

/**
 * SEC: Used only by login; returns nothing when user is inactive, deleted, or has no password row.
 */
export async function findAppUserLoginCredentialByEmail(
  email: string,
): Promise<AppUserLoginCredentialRow | undefined> {
  await ensureAppUserSchema();
  const normalized = email.trim().toLowerCase();

  if (normalized === "") {
    return undefined;
  }

  const result = await sql<AppUserLoginCredentialRow>`
    SELECT
      u.id AS user_id,
      bur.role_id AS role_id,
      ap.password_hash AS password_hash
    FROM app_user u
    INNER JOIN rbac_user_role bur ON bur.user_id = u.id
    INNER JOIN auth_password ap ON ap.user_id = u.id
    WHERE u.deleted_at IS NULL
      AND u.deactivated_at IS NULL
      AND lower(btrim(u.email)) = ${normalized}
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

/**
 * SEC: Password hash for session user only (change-password flow).
 */
export async function findAppUserPasswordHashByUserId(
  userId: number,
): Promise<{ password_hash: string } | undefined> {
  await ensureAppUserSchema();

  const result = await sql<{ password_hash: string }>`
    SELECT ap.password_hash AS password_hash
    FROM app_user u
    INNER JOIN auth_password ap ON ap.user_id = u.id
    WHERE u.id = ${userId}
      AND u.deleted_at IS NULL
      AND u.deactivated_at IS NULL
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

export async function findConflictingAppUserIdByEmailCaseInsensitive(
  email: string,
  excludeAppUserId?: number,
): Promise<number | undefined> {
  await ensureAppUserSchema();
  const normalized = email.trim().toLowerCase();

  const result =
    excludeAppUserId === undefined
      ? await sql<{ id: number }>`
          SELECT id
          FROM app_user
          WHERE deleted_at IS NULL
            AND lower(btrim(email)) = ${normalized}
          LIMIT 1
        `.execute(db)
      : await sql<{ id: number }>`
          SELECT id
          FROM app_user
          WHERE deleted_at IS NULL
            AND id <> ${excludeAppUserId}
            AND lower(btrim(email)) = ${normalized}
          LIMIT 1
        `.execute(db);

  return result.rows[0]?.id;
}

/**
 * Creates `app_user` and `auth_password` in one transaction.
 * SEC: `passwordHash` is Argon2id only; never exposed via list/detail.
 */
export async function insertAppUserRow(
  input: AppUserCreateRowInput,
  passwordHash: string,
): Promise<AppUserRow> {
  await ensureAppUserSchema();

  const id = await db.transaction().execute(async (trx) => {
    const insertResult = await sql<{ id: number }>`
      INSERT INTO app_user (
        email,
        full_name,
        deactivated_at,
        is_default
      )
      VALUES (
        ${input.email},
        ${input.full_name},
        ${input.deactivated_at},
        FALSE
      )
      RETURNING id
    `.execute(trx);

    const newId = insertResult.rows[0]?.id;
    if (newId === undefined) {
      throw new Error("App user insert returned no id.");
    }

    await sql`
      INSERT INTO rbac_user_role (user_id, role_id)
      VALUES (${newId}, ${input.role_id})
    `.execute(trx);

    await sql`
      INSERT INTO auth_password (user_id, password_hash, password_updated_at)
      VALUES (${newId}, ${passwordHash}, now())
    `.execute(trx);

    return newId;
  });

  const row = await getAppUserRowById(id);
  if (!row) {
    throw new Error("App user insert could not be reloaded.");
  }

  return row;
}

export async function updateAppUserRow(
  appUserId: number,
  input: CreateAppUserInput,
): Promise<AppUserRow | undefined> {
  return updateAppUserRowWithOptionalPasswordHash(appUserId, input, null);
}

/**
 * Updates profile/role and optionally password in one transaction.
 * SEC: `passwordHash` is Argon2id only when provided.
 */
export async function updateAppUserRowWithOptionalPasswordHash(
  appUserId: number,
  input: CreateAppUserInput,
  passwordHash: string | null,
): Promise<AppUserRow | undefined> {
  await ensureAppUserSchema();

  const result = await db.transaction().execute(async (trx) => {
    if (passwordHash !== null) {
      await sql`
        INSERT INTO auth_password (user_id, password_hash, password_updated_at)
        VALUES (${appUserId}, ${passwordHash}, now())
        ON CONFLICT (user_id) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          password_updated_at = now()
      `.execute(trx);
    }

    const profile = await sql<{ id: number }>`
      UPDATE app_user
      SET
        email = ${input.email},
        full_name = ${input.full_name},
        updated_at = now(),
        deactivated_at = CASE
          WHEN ${input.active} THEN NULL
          ELSE COALESCE(deactivated_at, now())
        END
      WHERE id = ${appUserId}
        AND deleted_at IS NULL
      RETURNING id
    `.execute(trx);

    if (!profile.rows[0]) {
      return undefined;
    }

    const rolePatch = await sql<{ user_id: number }>`
      UPDATE rbac_user_role
      SET role_id = ${input.role_id}
      WHERE user_id = ${appUserId}
      RETURNING user_id
    `.execute(trx);

    if (!rolePatch.rows[0]) {
      throw new Error("App user has no rbac_user_role row.");
    }

    return profile.rows[0].id;
  });

  if (result === undefined) {
    return undefined;
  }

  return getAppUserRowById(appUserId);
}

/**
 * SEC: Updates or inserts `auth_password` only (Argon2id hash).
 */
export async function upsertAuthPasswordHashForUser(
  userId: number,
  passwordHash: string,
): Promise<void> {
  await ensureAppUserSchema();

  await sql`
    INSERT INTO auth_password (user_id, password_hash, password_updated_at)
    VALUES (${userId}, ${passwordHash}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      password_updated_at = now()
  `.execute(db);
}

export async function markAppUserRowDeleted(
  appUserId: number,
): Promise<AppUserRow | undefined> {
  await ensureAppUserSchema();
  const roleTable = await resolveRbacRoleTableName();

  const result = await sql<AppUserRow>`
    UPDATE app_user AS u
    SET
      deleted_at = now(),
      updated_at = now()
    FROM rbac_user_role AS bur
    INNER JOIN ${sql.table(roleTable)} AS r ON r.id = bur.role_id
    WHERE u.id = ${appUserId}
      AND bur.user_id = u.id
      AND u.deleted_at IS NULL
    RETURNING
      u.id,
      u.email,
      u.full_name,
      bur.role_id AS role_id,
      r.label AS role_label,
      u.created_at::text AS created_at,
      u.updated_at::text AS updated_at,
      u.deactivated_at::text AS deactivated_at,
      u.deleted_at::text AS deleted_at,
      COALESCE(u.is_default, FALSE) AS is_default
  `.execute(db);

  return result.rows[0];
}

/** SEC: Hard cap for dropdown payloads (internal API only). */
const APP_USER_OPTIONS_MAX = 5000;

/**
 * Compact rows for admin selects (`GET /api/app-users/options`).
 * Label: `Full Name (email)` when name is set, else email only.
 */
export async function listAppUserOptionRows(): Promise<AppUserOptionRow[]> {
  await ensureAppUserSchema();

  const result = await sql<AppUserOptionRow>`
    SELECT
      u.id,
      CASE
        WHEN NULLIF(BTRIM(u.full_name), '') IS NULL THEN u.email
        ELSE BTRIM(u.full_name) || ' (' || u.email || ')'
      END AS label
    FROM app_user u
    WHERE u.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM rbac_user_role bur
        WHERE bur.user_id = u.id
      )
    ORDER BY
      LOWER(
        CASE
          WHEN NULLIF(BTRIM(u.full_name), '') IS NULL THEN u.email
          ELSE BTRIM(u.full_name)
        END
      ),
      u.id
    LIMIT ${APP_USER_OPTIONS_MAX}
  `.execute(db);

  return result.rows;
}
