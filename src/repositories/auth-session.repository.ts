import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { db } from "@/db/client";
import type {
  AuthSessionListFilters,
  AuthSessionListRow,
} from "@/modules/auth-session/types";
import { ensureAppUserSchema } from "@/repositories/app-user.repository";
import { resolveRbacRoleTableName } from "@/repositories/user-role.repository";

type ResolvedRbacRoleTable = Awaited<
  ReturnType<typeof resolveRbacRoleTableName>
>;

let authSessionSchemaPromise: Promise<void> | null = null;

export async function ensureAuthSessionSchema(): Promise<void> {
  if (process.env.RBAC_SKIP_DDL === "1") {
    return;
  }

  if (authSessionSchemaPromise === null) {
    authSessionSchemaPromise = runAuthSessionSchemaPatches().catch((error) => {
      authSessionSchemaPromise = null;
      throw error;
    });
  }

  return authSessionSchemaPromise;
}

async function runAuthSessionSchemaPatches(): Promise<void> {
  await ensureAppUserSchema();

  await sql`
    CREATE TABLE IF NOT EXISTS auth_session (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      csrf_token TEXT NULL
    )
  `.execute(db);

  await sql`
    ALTER TABLE auth_session
      ADD COLUMN IF NOT EXISTS csrf_token TEXT
  `.execute(db);

  // SEC: Login stores session id (UUID) in HttpOnly cookie — not a separate bearer token.
  // Older DBs may have token_hash NOT NULL; relax so inserts match current code path.
  await sql`
    DO $patch_auth_session_token_hash$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'auth_session'
          AND column_name = 'token_hash'
      ) THEN
        ALTER TABLE auth_session
          ALTER COLUMN token_hash DROP NOT NULL;
      END IF;
    END
    $patch_auth_session_token_hash$
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_auth_session_user_id
      ON auth_session (user_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_auth_session_expires_at
      ON auth_session (expires_at DESC)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_auth_session_created_at
      ON auth_session (created_at DESC)
  `.execute(db);
}

export type AuthSessionInsertInput = {
  userId: number;
  roleId: number;
  userAgent: string;
  ip: string;
  expiresAt: Date;
};

export async function insertAuthSessionRow(
  input: AuthSessionInsertInput,
): Promise<{ id: string; csrfToken: string }> {
  await ensureAuthSessionSchema();

  // SEC: CSRF secret for double-submit / header checks on mutating requests (stored server-side).
  const csrfToken = randomBytes(24).toString("base64url");

  const result = await sql<{ id: string }>`
    INSERT INTO auth_session (
      user_id,
      role_id,
      user_agent,
      ip,
      expires_at,
      csrf_token
    )
    VALUES (
      ${input.userId},
      ${input.roleId},
      ${input.userAgent},
      ${input.ip},
      ${input.expiresAt},
      ${csrfToken}
    )
    RETURNING id::text AS id
  `.execute(db);

  const id = result.rows[0]?.id;

  if (!id) {
    throw new Error("auth_session insert returned no id.");
  }

  return { id, csrfToken };
}

export type ActiveAuthSessionCredential = {
  id: string;
  user_id: number;
  role_id: number;
  csrf_token: string | null;
};

/**
 * SEC: Valid session only — not revoked and not past expires_at.
 */
export async function findActiveAuthSessionById(
  sessionId: string,
): Promise<ActiveAuthSessionCredential | undefined> {
  await ensureAuthSessionSchema();

  const result = await sql<ActiveAuthSessionCredential>`
    SELECT
      s.id::text AS id,
      s.user_id,
      s.role_id,
      s.csrf_token
    FROM auth_session s
    WHERE s.id = ${sessionId}::uuid
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

function getSearchPattern(search: string): string {
  const escapeReplacement = String.raw`\$&`;
  const escapedSearch = search.replaceAll(/[%_\\]/g, escapeReplacement);

  return `%${escapedSearch}%`;
}

function roleJoinFragment(roleTable: ResolvedRbacRoleTable) {
  return roleTable === "rbac_role"
    ? sql`inner join rbac_role r on r.id = s.role_id`
    : sql`inner join user_role r on r.id = s.role_id`;
}

function listWhereParts(filters: AuthSessionListFilters) {
  const parts: ReturnType<typeof sql>[] = [sql`true`];

  if (filters.userId !== null) {
    parts.push(sql`s.user_id = ${filters.userId}`);
  }

  if (filters.userSearch !== "") {
    const pattern = getSearchPattern(filters.userSearch);
    parts.push(sql`
      (
        u.full_name ilike ${pattern} escape '\'
        or u.email ilike ${pattern} escape '\'
      )
    `);
  }

  if (filters.roleId !== null) {
    parts.push(sql`s.role_id = ${filters.roleId}`);
  }

  if (filters.expiresStart) {
    parts.push(
      sql`s.expires_at >= ${`${filters.expiresStart}T00:00:00.000Z`}::timestamptz`,
    );
  }

  if (filters.expiresEnd) {
    parts.push(
      sql`s.expires_at <= ${`${filters.expiresEnd}T23:59:59.999Z`}::timestamptz`,
    );
  }

  if (filters.revokedStart) {
    parts.push(sql`s.revoked_at is not null`);
    parts.push(
      sql`s.revoked_at >= ${`${filters.revokedStart}T00:00:00.000Z`}::timestamptz`,
    );
  }

  if (filters.revokedEnd) {
    parts.push(sql`s.revoked_at is not null`);
    parts.push(
      sql`s.revoked_at <= ${`${filters.revokedEnd}T23:59:59.999Z`}::timestamptz`,
    );
  }

  if (filters.createdStart) {
    parts.push(
      sql`s.created_at >= ${`${filters.createdStart}T00:00:00.000Z`}::timestamptz`,
    );
  }

  if (filters.createdEnd) {
    parts.push(
      sql`s.created_at <= ${`${filters.createdEnd}T23:59:59.999Z`}::timestamptz`,
    );
  }

  return sql.join(parts, sql` and `);
}

export async function countAuthSessionRows(
  filters: AuthSessionListFilters,
): Promise<number> {
  await ensureAuthSessionSchema();
  const roleTable = await resolveRbacRoleTableName();
  const roleJoin = roleJoinFragment(roleTable);
  const whereClause = listWhereParts(filters);

  const result = await sql<{ count: string }>`
    select count(*)::text as count
    from auth_session s
    inner join app_user u on u.id = s.user_id
    ${roleJoin}
    where ${whereClause}
  `.execute(db);

  const raw = result.rows[0]?.count ?? "0";
  const total = Number.parseInt(raw, 10);

  return Number.isFinite(total) ? total : 0;
}

export async function listAuthSessionRows(
  filters: AuthSessionListFilters,
): Promise<AuthSessionListRow[]> {
  await ensureAuthSessionSchema();
  const roleTable = await resolveRbacRoleTableName();
  const roleJoin = roleJoinFragment(roleTable);
  const whereClause = listWhereParts(filters);
  const limit = filters.limit;
  const offset = filters.offset;

  const result = await sql<AuthSessionListRow>`
    select
      s.id::text as id,
      s.user_id,
      s.role_id,
      s.user_agent,
      s.ip,
      s.expires_at::text as expires_at,
      s.revoked_at::text as revoked_at,
      s.created_at::text as created_at,
      coalesce(nullif(btrim(u.full_name), ''), u.email) as user_label,
      coalesce(r.label, '') as role_label
    from auth_session s
    inner join app_user u on u.id = s.user_id
    ${roleJoin}
    where ${whereClause}
    order by s.created_at desc, s.id desc
    limit ${limit}
    offset ${offset}
  `.execute(db);

  return result.rows.map((row) => ({
    ...row,
    revoked_at: row.revoked_at === null || row.revoked_at === "" ? null : row.revoked_at,
  }));
}

export async function revokeAuthSessionById(
  sessionId: string,
): Promise<AuthSessionListRow | null> {
  await ensureAuthSessionSchema();
  const roleTable = await resolveRbacRoleTableName();
  const roleJoin = roleJoinFragment(roleTable);

  const result = await sql<AuthSessionListRow>`
    with updated as (
      update auth_session
      set revoked_at = now()
      where id = ${sessionId}::uuid
        and revoked_at is null
      returning id
    )
    select
      s.id::text as id,
      s.user_id,
      s.role_id,
      s.user_agent,
      s.ip,
      s.expires_at::text as expires_at,
      s.revoked_at::text as revoked_at,
      s.created_at::text as created_at,
      coalesce(nullif(btrim(u.full_name), ''), u.email) as user_label,
      coalesce(r.label, '') as role_label
    from auth_session s
    inner join app_user u on u.id = s.user_id
    ${roleJoin}
    inner join updated on updated.id = s.id
  `.execute(db);

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    ...row,
    revoked_at:
      row.revoked_at === null || row.revoked_at === "" ? null : row.revoked_at,
  };
}

/**
 * SEC: Hard-delete session row (admin DELETE). Returns whether a row was removed.
 */
export async function deleteAuthSessionById(sessionId: string): Promise<boolean> {
  await ensureAuthSessionSchema();

  const result = await sql<{ id: string }>`
    delete from auth_session
    where id = ${sessionId}::uuid
    returning id::text as id
  `.execute(db);

  return result.rows.length > 0;
}
