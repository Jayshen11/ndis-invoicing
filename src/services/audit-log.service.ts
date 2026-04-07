import { ApiError } from "@/lib/api/errors";
import type { ApiAuthContext } from "@/lib/api/auth";
import type {
  AuditActor,
  AuditLogActionValue,
  AuditLogChangeDiff,
  AuditLogEntityValue,
  AuditLogInsertInput,
  AuditLogListFilters,
  AuditLogListPage,
  AuditLogPermissionValue,
  AuditLogOption,
} from "@/modules/audit-log/types";
import {
  AUDIT_LOG_ACTION_OPTIONS,
  AUDIT_LOG_ENTITY_OPTIONS,
  AUDIT_LOG_PERMISSION_OPTIONS,
} from "@/modules/audit-log/types";
import {
  countAuditLogRows,
  insertAuditLogRow,
  listAuditLogRows,
  resolveFallbackAuditActor,
} from "@/repositories/audit-log.repository";
import { getRbacRoleLabelById } from "@/repositories/user-role.repository";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AUDIT_REDACTED_KEYS = new Set([
  "generatedPassword",
  "generated_password",
  "password",
  "password_hash",
  "passwordPlainForHash",
  "token",
  "refresh_token",
  "access_token",
  "secret",
]);

// SEC: Omit non-semantic bookkeeping fields from stored payload and change diffs.
const AUDIT_IGNORED_CHANGE_KEYS = new Set(["updated_at"]);

const ACTION_LABEL_BY_VALUE = new Map(
  AUDIT_LOG_ACTION_OPTIONS.map((option) => [option.value, option.label]),
);
const ENTITY_LABEL_BY_VALUE = new Map(
  AUDIT_LOG_ENTITY_OPTIONS.map((option) => [option.value, option.label]),
);
const PERMISSION_LABEL_BY_VALUE = new Map(
  AUDIT_LOG_PERMISSION_OPTIONS.map((option) => [option.value, option.label]),
);

export function listAuditLogActionOptions(): AuditLogOption[] {
  return [...AUDIT_LOG_ACTION_OPTIONS];
}

export function listAuditLogEntityOptions(): AuditLogOption[] {
  return [...AUDIT_LOG_ENTITY_OPTIONS];
}

export function listAuditLogPermissionOptions(): AuditLogOption[] {
  return [...AUDIT_LOG_PERMISSION_OPTIONS];
}

/**
 * SEC: Prefer this for API routes so audit rows attribute the signed-in operator,
 * not an arbitrary fallback user from {@link resolveFallbackAuditActor}.
 */
export async function resolveAuditActorForApiAuth(
  ctx: ApiAuthContext,
): Promise<AuditActor> {
  if (ctx.kind === "internal") {
    return resolveFallbackAuditActor();
  }

  const { user } = ctx.payload;
  const roleLabel = await getRbacRoleLabelById(user.roleId);
  const name = user.fullName.trim();

  return {
    actor_user_id: user.id,
    actor_user_label: name === "" ? user.email : name,
    actor_role_id: user.roleId,
    actor_role_label: roleLabel ?? "",
  };
}

export async function listAuditLogsPage(
  searchParams: URLSearchParams,
): Promise<AuditLogListPage> {
  const filters = parseAuditLogListFilters(searchParams);
  const [total, data] = await Promise.all([
    countAuditLogRows(filters),
    listAuditLogRows(filters),
  ]);

  return {
    data,
    pagination: {
      limit: filters.limit,
      offset: filters.offset,
      total,
    },
  };
}

export async function recordAuditEvent(input: {
  action: AuditLogActionValue;
  entity: AuditLogEntityValue;
  permission?: AuditLogPermissionValue | null;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  /** When omitted, uses {@link resolveFallbackAuditActor} (legacy heuristic). */
  actor?: AuditActor;
}): Promise<void> {
  try {
    const actor =
      input.actor ?? (await resolveFallbackAuditActor());
    const beforeRecord = toAuditRecord(input.before);
    const afterRecord = toAuditRecord(input.after);
    const changesDiff = createAuditDiff(beforeRecord, afterRecord);

    // SEC: Skip no-op updates — same data after sanitization should not create noise rows.
    if (
      beforeRecord !== null &&
      afterRecord !== null &&
      changesDiff === null
    ) {
      return;
    }

    const row: AuditLogInsertInput = {
      ...actor,
      action: input.action,
      action_label: auditLabelFromMap(ACTION_LABEL_BY_VALUE, input.action),
      permission_code: input.permission ?? null,
      permission_label:
        input.permission === undefined || input.permission === null
          ? null
          : auditLabelFromMap(PERMISSION_LABEL_BY_VALUE, input.permission),
      entity: input.entity,
      entity_label: auditLabelFromMap(ENTITY_LABEL_BY_VALUE, input.entity),
      entity_id:
        input.entityId === undefined || input.entityId === null
          ? null
          : String(input.entityId),
      payload: afterRecord,
      changes_diff: changesDiff,
      before: createAuditSummary(changesDiff, "before"),
      after: createAuditSummary(changesDiff, "after"),
    };

    await insertAuditLogRow(row);
  } catch (error) {
    // SEC: Audit logging should not block the primary mutation path.
    console.error("audit-log: failed to record event", error);
  }
}

function parseAuditLogListFilters(searchParams: URLSearchParams): AuditLogListFilters {
  const limit = parseBoundedIntParam(
    searchParams.get("limit"),
    "limit",
    DEFAULT_LIST_LIMIT,
    1,
    MAX_LIST_LIMIT,
  );
  const offset = parseBoundedIntParam(
    searchParams.get("offset"),
    "offset",
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  const created_start = parseOptionalDate(searchParams.get("created_start"), "created_start");
  const created_end = parseOptionalDate(searchParams.get("created_end"), "created_end");

  return {
    user_id: parseOptionalPositiveInt(searchParams.get("user_id"), "user_id"),
    role_id: parseOptionalPositiveInt(searchParams.get("role_id"), "role_id"),
    action: parseOptionalEnum(
      searchParams.get("action"),
      "action",
      ACTION_LABEL_BY_VALUE,
    ),
    permission: parseOptionalEnum(
      searchParams.get("permission"),
      "permission",
      PERMISSION_LABEL_BY_VALUE,
    ),
    entity: parseOptionalEnum(
      searchParams.get("entity"),
      "entity",
      ENTITY_LABEL_BY_VALUE,
    ),
    created_start,
    created_end,
    limit,
    offset,
  };
}

function parseBoundedIntParam(
  raw: string | null,
  field: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === null || raw.trim() === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field, message: `Must be an integer between ${min} and ${max}.` },
    ]);
  }

  return parsed;
}

function parseOptionalPositiveInt(
  raw: string | null,
  field: string,
): number | undefined {
  if (raw === null || raw.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(raw.trim(), 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field, message: "Must be a positive integer." },
    ]);
  }

  return parsed;
}

function parseOptionalDate(raw: string | null, field: string): string | undefined {
  if (raw === null || raw.trim() === "") {
    return undefined;
  }

  const value = raw.trim();

  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field, message: "Must be a date in YYYY-MM-DD format." },
    ]);
  }

  return value;
}

function parseOptionalEnum<TValue extends string>(
  raw: string | null,
  field: string,
  allowed: ReadonlyMap<TValue, string>,
): TValue | undefined {
  if (raw === null || raw.trim() === "") {
    return undefined;
  }

  const value = raw.trim() as TValue;

  if (!allowed.has(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field, message: "Unsupported value." },
    ]);
  }

  return value;
}

/** SEC: Never throw — unknown slugs still produce a row (forward-compatible catalog). */
function auditLabelFromMap<TValue extends string>(
  map: ReadonlyMap<TValue, string>,
  value: TValue,
): string {
  return map.get(value) ?? value;
}

function createAuditDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditLogChangeDiff | null {
  if (before === null && after === null) {
    return null;
  }

  if (before === null || after === null) {
    return null;
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diff: AuditLogChangeDiff = {};

  for (const key of keys) {
    const beforeValue = before[key] ?? null;
    const afterValue = after[key] ?? null;

    if (stableStringify(beforeValue) === stableStringify(afterValue)) {
      continue;
    }

    diff[key] = {
      before: beforeValue,
      after: afterValue,
    };
  }

  if (Object.keys(diff).length === 0) {
    return null;
  }

  return diff;
}

function toAuditRecord(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    return null;
  }

  return sanitizeAuditRecord(value);
}

function sanitizeAuditRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const nextKey = toSnakeCase(key);

    if (AUDIT_IGNORED_CHANGE_KEYS.has(nextKey)) {
      continue;
    }

    if (AUDIT_REDACTED_KEYS.has(key)) {
      output[nextKey] = "[REDACTED]";
      continue;
    }

    if (Array.isArray(value)) {
      output[nextKey] = value.map((item) =>
        isPlainObject(item) ? sanitizeAuditRecord(item) : item,
      );
      continue;
    }

    if (isPlainObject(value)) {
      output[nextKey] = sanitizeAuditRecord(value);
      continue;
    }

    if (value !== undefined) {
      output[nextKey] = value;
    }
  }

  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value ?? null);
}

function createAuditSummary(
  diff: AuditLogChangeDiff | null,
  side: "before" | "after",
): string | null {
  if (diff === null) {
    return null;
  }

  const entries = Object.entries(diff).map(([key, values]) => {
    const value = side === "before" ? values.before : values.after;
    return `${key}: ${formatSummaryValue(value)}`;
  });

  return entries.length > 0 ? entries.join(", ") : null;
}

function formatSummaryValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return stableStringify(value);
}

function toSnakeCase(value: string): string {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/[\s-]+/g, "_")
    .toLowerCase();
}
