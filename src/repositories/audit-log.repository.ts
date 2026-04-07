import { sql } from "kysely";
import { db } from "@/db/client";
import type {
  AuditActor,
  AuditLogInsertInput,
  AuditLogListFilters,
  AuditLogRow,
} from "@/modules/audit-log/types";
import { ensureAppUserSchema } from "@/repositories/app-user.repository";
import {
  ensureRbacRoleSchemaPatches,
  resolveRbacRoleTableName,
} from "@/repositories/user-role.repository";

type ResolvedRbacRoleTable = Awaited<
  ReturnType<typeof resolveRbacRoleTableName>
>;

let auditLogSchemaPromise: Promise<void> | null = null;

export async function ensureAuditLogSchema(): Promise<void> {
  if (process.env.RBAC_SKIP_DDL === "1") {
    return;
  }

  auditLogSchemaPromise ??= runAuditLogSchemaPatches().catch((error) => {
    auditLogSchemaPromise = null;
    throw error;
  });

  return auditLogSchemaPromise;
}

/**
 * Align legacy / gateway `audit_log` tables (e.g. actor_user_id) with this app's
 * column names (user_id). CREATE TABLE IF NOT EXISTS leaves an existing table unchanged.
 */
async function patchAuditLogLegacyColumnNames(): Promise<void> {
  await sql`
    DO $audit_patch$
    BEGIN
      IF to_regclass('public.audit_log') IS NOT NULL THEN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'actor_user_id'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'user_id'
        ) THEN
          ALTER TABLE public.audit_log RENAME COLUMN actor_user_id TO user_id;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'actor_user_label'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'user_label'
        ) THEN
          ALTER TABLE public.audit_log RENAME COLUMN actor_user_label TO user_label;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'actor_role_id'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'role_id'
        ) THEN
          ALTER TABLE public.audit_log RENAME COLUMN actor_role_id TO role_id;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'actor_role_label'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'role_label'
        ) THEN
          ALTER TABLE public.audit_log RENAME COLUMN actor_role_label TO role_label;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'permission_code'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'audit_log'
            AND c.column_name = 'permission'
        ) THEN
          ALTER TABLE public.audit_log RENAME COLUMN permission_code TO permission;
        END IF;
      END IF;
    END
    $audit_patch$
  `.execute(db);
}

/** Backfill columns expected by this app when `audit_log` predates the full schema. */
async function patchAuditLogMissingColumns(): Promise<void> {
  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS user_id INTEGER NULL REFERENCES app_user (id) ON DELETE SET NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS user_label TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS role_id INTEGER NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS role_label TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS action TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS action_label TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS permission TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS permission_label TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS entity TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS entity_label TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS entity_id TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS before_data JSONB NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS after_data JSONB NULL
  `.execute(db);
}

async function runAuditLogSchemaPatches(): Promise<void> {
  await Promise.all([ensureAppUserSchema(), ensureRbacRoleSchemaPatches()]);

  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NULL REFERENCES app_user (id) ON DELETE SET NULL,
      user_label TEXT NULL,
      role_id INTEGER NULL,
      role_label TEXT NULL,
      action TEXT NOT NULL,
      action_label TEXT NOT NULL,
      permission TEXT NULL,
      permission_label TEXT NULL,
      entity TEXT NOT NULL,
      entity_label TEXT NOT NULL,
      entity_id TEXT NULL,
      payload JSONB NULL,
      changes_diff JSONB NULL,
      before TEXT NULL,
      after TEXT NULL,
      before_data JSONB NULL,
      after_data JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await patchAuditLogLegacyColumnNames();
  await patchAuditLogMissingColumns();

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS payload JSONB NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS changes_diff JSONB NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS before TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS after TEXT NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
      ON audit_log (created_at DESC, id DESC)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id
      ON audit_log (user_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_role_id
      ON audit_log (role_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_action
      ON audit_log (action)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_permission
      ON audit_log (permission)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity
      ON audit_log (entity)
  `.execute(db);
}

function auditLogWhereClause(filters: AuditLogListFilters) {
  const parts: ReturnType<typeof sql>[] = [sql`true`];

  if (filters.user_id !== undefined) {
    parts.push(sql`l.user_id = ${filters.user_id}`);
  }

  if (filters.role_id !== undefined) {
    parts.push(sql`l.role_id = ${filters.role_id}`);
  }

  if (filters.action !== undefined) {
    parts.push(sql`l.action = ${filters.action}`);
  }

  if (filters.permission !== undefined) {
    parts.push(sql`l.permission = ${filters.permission}`);
  }

  if (filters.entity !== undefined) {
    parts.push(sql`l.entity = ${filters.entity}`);
  }

  if (filters.created_start) {
    parts.push(sql`l.created_at >= ${toStartOfDayIso(filters.created_start)}::timestamptz`);
  }

  if (filters.created_end) {
    parts.push(sql`l.created_at <= ${toEndOfDayIso(filters.created_end)}::timestamptz`);
  }

  return sql.join(parts, sql` and `);
}

function toStartOfDayIso(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function toEndOfDayIso(value: string): string {
  return `${value}T23:59:59.999Z`;
}

function parseJsonObject(
  value: string | null,
): Record<string, unknown> | null {
  if (value === null || value.trim() === "" || value.trim() === "null") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonDiff(
  value: string | null,
): AuditLogRow["changes_diff"] {
  if (value === null || value.trim() === "" || value.trim() === "null") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? (parsed as AuditLogRow["changes_diff"]) : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roleJoinFragment(roleTable: ResolvedRbacRoleTable) {
  return roleTable === "rbac_role"
    ? sql`inner join rbac_role r on r.id = bur.role_id`
    : sql`inner join user_role r on r.id = bur.role_id`;
}

export async function countAuditLogRows(
  filters: AuditLogListFilters,
): Promise<number> {
  await ensureAuditLogSchema();
  const whereClause = auditLogWhereClause(filters);

  const result = await sql<{ count: string }>`
    select count(*)::text as count
    from audit_log l
    where ${whereClause}
  `.execute(db);

  const raw = result.rows[0]?.count ?? "0";
  const total = Number.parseInt(raw, 10);

  return Number.isFinite(total) ? total : 0;
}

export async function listAuditLogRows(
  filters: AuditLogListFilters,
): Promise<AuditLogRow[]> {
  await ensureAuditLogSchema();
  const whereClause = auditLogWhereClause(filters);

  const result = await sql<
    Omit<AuditLogRow, "payload" | "changes_diff"> & {
      payload: string | null;
      changes_diff: string | null;
    }
  >`
    select
      l.id::text as id,
      l.user_id as actor_user_id,
      l.user_label as actor_user_label,
      l.role_id as actor_role_id,
      l.role_label as actor_role_label,
      l.action,
      l.action_label,
      l.permission as permission_code,
      l.permission_label,
      l.entity_label as entity,
      l.entity_id,
      l.payload::text as payload,
      l.changes_diff::text as changes_diff,
      l.before,
      l.after,
      l.created_at::text as created_at
    from audit_log l
    where ${whereClause}
    order by l.created_at desc, l.id desc
    limit ${filters.limit}
    offset ${filters.offset}
  `.execute(db);

  return result.rows.map((row) => ({
    ...row,
    payload: parseJsonObject(row.payload),
    changes_diff: parseJsonDiff(row.changes_diff),
  }));
}

export async function insertAuditLogRow(
  input: AuditLogInsertInput,
): Promise<void> {
  await ensureAuditLogSchema();

  await sql`
    insert into audit_log (
      user_id,
      user_label,
      role_id,
      role_label,
      action,
      action_label,
      permission,
      permission_label,
      entity,
      entity_label,
      entity_id,
      payload,
      changes_diff,
      before,
      after,
      before_data,
      after_data
    )
    values (
      ${input.actor_user_id},
      ${input.actor_user_label},
      ${input.actor_role_id},
      ${input.actor_role_label},
      ${input.action},
      ${input.action_label},
      ${input.permission_code},
      ${input.permission_label},
      ${input.entity},
      ${input.entity_label},
      ${input.entity_id},
      ${input.payload === null ? null : JSON.stringify(input.payload)}::jsonb,
      ${input.changes_diff === null ? null : JSON.stringify(input.changes_diff)}::jsonb,
      ${input.before},
      ${input.after},
      null::jsonb,
      null::jsonb
    )
  `.execute(db);
}

export async function resolveFallbackAuditActor(): Promise<AuditActor> {
  await ensureAuditLogSchema();
  const roleTable = await resolveRbacRoleTableName();
  const roleJoin = roleJoinFragment(roleTable);

  const result = await sql<AuditActor>`
    select
      u.id as actor_user_id,
      coalesce(nullif(btrim(u.full_name), ''), u.email) as actor_user_label,
      bur.role_id as actor_role_id,
      coalesce(r.label, '') as actor_role_label
    from app_user u
    inner join rbac_user_role bur on bur.user_id = u.id
    ${roleJoin}
    where u.deleted_at is null
    order by
      case
        when lower(btrim(u.full_name)) = 'test admin' then 0
        when lower(btrim(u.email)) = 'test@wittydata.com' then 1
        when u.is_default = true then 2
        else 3
      end,
      u.id asc
    limit 1
  `.execute(db);

  return (
    result.rows[0] ?? {
      actor_user_id: null,
      actor_user_label: null,
      actor_role_id: null,
      actor_role_label: null,
    }
  );
}
