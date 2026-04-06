import { ApiError, type ApiErrorDetail } from "@/lib/api/errors";
import {
  countUserRoleRows,
  findConflictingUserRoleIdByCodeCaseInsensitive,
  getUserRoleRowById,
  insertUserRoleRow,
  listRbacRoleOptionRows,
  listUserRoleRows,
  markUserRoleRowDeleted,
  updateUserRoleRow,
} from "@/repositories/user-role.repository";
import {
  mapUserRoleRowToCreateUserRoleInput,
  normalizeUserRoleListRowTimestamps,
  normalizeUserRoleRowTimestamps,
  toRbacRoleDetailItem,
  toRbacRoleListItem,
  type CreateUserRoleInput,
  type RbacRoleDetailItem,
  type RbacRoleListItem,
  type RbacRoleOptionRow,
  type UserRoleCreateRowInput,
  type UserRoleListFilters,
  type UserRoleRow,
  type UserRoleStatusFilter,
  type UpdateUserRoleInput,
} from "@/modules/user-role/types";
import {
  ALL_KNOWN_PERMISSION_SLUGS,
  getAllPermissionSlugsSorted,
  getRbacPermissionGatewayIdsSorted,
  RBAC_PERMISSION_GATEWAY_ID_BY_CODE,
} from "@/modules/user-role/permissions-catalog";
import { recordAuditEvent } from "@/services/audit-log.service";

const ALLOWED_CREATE_FIELDS = new Set([
  "code",
  "deactivated_at",
  "label",
  "permissions",
]);
const ALLOWED_UPDATE_FIELDS = new Set([
  "active",
  "code",
  "label",
  "permissions",
]);
const CODE_MAX_LENGTH = 50;
const LABEL_MAX_LENGTH = 100;
const SEARCH_MAX_LENGTH = 100;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
// SEC: Printable ASCII only for create codes (no control chars / unicode tricks).
const CREATE_CODE_PATTERN = /^[\x21-\x7E]+$/;
const DEFAULT_USER_ROLE_LIST_LIMIT = 20;
// SEC: Caps page size to limit DoS via huge LIMIT queries; lookups use status=active + high limit.
const MAX_USER_ROLE_LIST_LIMIT = 500;

export type UserRoleListPage = {
  data: RbacRoleListItem[];
  pagination: { limit: number; offset: number; total: number };
};

function permissionIdsFromKnownSlugs(slugs: readonly string[]): number[] {
  const ids = slugs
    .map((code) => RBAC_PERMISSION_GATEWAY_ID_BY_CODE[code])
    .filter((id): id is number => typeof id === "number");

  return [...new Set(ids)].sort((a, b) => a - b);
}

/** Junction may be empty while legacy `permissions` JSON still lists slugs. */
function augmentDetailRowPermissionIds(row: UserRoleRow): UserRoleRow {
  if (row.permission_ids.length > 0 || row.permissions.length === 0) {
    return row;
  }

  return {
    ...row,
    permission_ids: permissionIdsFromKnownSlugs(row.permissions),
  };
}

function resolveUserRoleRowForApi(row: UserRoleRow): UserRoleRow {
  if (!row.is_default) {
    return row;
  }

  return {
    ...row,
    permissions: getAllPermissionSlugsSorted(),
    permission_ids: getRbacPermissionGatewayIdsSorted(),
  };
}

export async function listRbacRoleOptions(): Promise<RbacRoleOptionRow[]> {
  try {
    return await listRbacRoleOptionRows();
  } catch (error) {
    throw translateRepositoryError(error, "read");
  }
}

export async function listUserRolesPage(
  input: URLSearchParams | UserRoleListFilters,
): Promise<UserRoleListPage> {
  const filters =
    input instanceof URLSearchParams ? parseUserRoleListFilters(input) : input;

  try {
    const [total, rows] = await Promise.all([
      countUserRoleRows(filters),
      listUserRoleRows(filters),
    ]);

    return {
      data: rows.map((row) =>
        toRbacRoleListItem(normalizeUserRoleListRowTimestamps(row)),
      ),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total,
      },
    };
  } catch (error) {
    throw translateRepositoryError(error, "read");
  }
}

export async function createUserRole(payload: unknown): Promise<UserRoleRow> {
  const input = validateCreateUserRoleApiPayload(payload);

  try {
    await assertUserRoleCodeNotConflicting(input.code);

    const row = await insertUserRoleRow({
      ...input,
      permissions: input.permissions,
    });

    return normalizeUserRoleRowTimestamps(resolveUserRoleRowForApi(row));
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "create");
  }
}

export async function getUserRole(
  userRoleIdValue: string,
): Promise<RbacRoleDetailItem> {
  const userRoleId = parseUserRoleId(userRoleIdValue);

  try {
    const row = await getUserRoleRowById(userRoleId);

    if (!row) {
      throw createUserRoleNotFoundError();
    }

    return toRbacRoleDetailItem(
      augmentDetailRowPermissionIds(
        normalizeUserRoleRowTimestamps(resolveUserRoleRowForApi(row)),
      ),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "read");
  }
}

export async function updateUserRole(
  userRoleIdValue: string,
  payload: unknown,
): Promise<UserRoleRow> {
  const userRoleId = parseUserRoleId(userRoleIdValue);
  const patch = validateUpdateUserRolePayload(payload);

  try {
    const existingRow = await getUserRoleRowById(userRoleId);

    if (!existingRow) {
      throw createUserRoleNotFoundError();
    }

    if (existingRow.is_default) {
      if (
        patch.code !== undefined &&
        patch.code.trim().toUpperCase() !== existingRow.code.trim().toUpperCase()
      ) {
        throw new ApiError(
          403,
          "USER_ROLE_PROTECTED",
          "This role's code cannot be changed.",
        );
      }
    }

    const input: CreateUserRoleInput = {
      ...mapUserRoleRowToCreateUserRoleInput(existingRow),
      ...patch,
    };

    if (existingRow.is_default) {
      input.permissions = getAllPermissionSlugsSorted();
    }

    if (patch.code !== undefined) {
      await assertUserRoleCodeNotConflicting(input.code, userRoleId);
    }

    const updatedRow = await updateUserRoleRow(userRoleId, input);

    if (!updatedRow) {
      throw createUserRoleNotFoundError();
    }

    const previous = normalizeUserRoleRowTimestamps(
      resolveUserRoleRowForApi(existingRow),
    );
    const current = normalizeUserRoleRowTimestamps(
      resolveUserRoleRowForApi(updatedRow),
    );

    await recordAuditEvent({
      action: "rbac_role.update",
      entity: "rbac_role",
      entityId: current.id,
      permission: "user_roles.write",
      before: previous,
      after: current,
    });

    return current;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "update");
  }
}

export async function markUserRoleDeleted(
  userRoleIdValue: string,
): Promise<UserRoleRow> {
  const userRoleId = parseUserRoleId(userRoleIdValue);

  try {
    const existing = await getUserRoleRowById(userRoleId);

    if (!existing) {
      throw createUserRoleNotFoundError();
    }

    if (existing.is_default) {
      throw new ApiError(
        403,
        "USER_ROLE_PROTECTED",
        "This role cannot be deleted.",
      );
    }

    const row = await markUserRoleRowDeleted(userRoleId);

    if (!row) {
      throw createUserRoleNotFoundError();
    }

    return normalizeUserRoleRowTimestamps(row);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "update");
  }
}

/** `exists` is true when another non-deleted row already uses this code (case-insensitive). */
export type UserRoleCodeExistsResult = {
  exists: boolean;
};

/** Sec: Same case-insensitive rules as create/update; empty input skips DB (no error while clearing field). */
export async function checkUserRoleCodeExists(
  searchParams: URLSearchParams,
): Promise<UserRoleCodeExistsResult> {
  const codeRaw = searchParams.get("code") ?? "";
  if (codeRaw.trim() === "") {
    return { exists: false };
  }

  const excludeRaw = searchParams.get("exclude_id");
  let excludeId: number | undefined;
  if (excludeRaw !== null && excludeRaw.trim() !== "") {
    excludeId = parseUserRoleId(excludeRaw.trim());
  }

  const details: ApiErrorDetail[] = [];
  const normalized =
    excludeId !== undefined
      ? validateRequiredCode(codeRaw, details)
      : validateCreateApiCode(codeRaw, details);

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  if (!normalized) {
    return { exists: false };
  }

  try {
    const conflictingId = await findConflictingUserRoleIdByCodeCaseInsensitive(
      normalized,
      excludeId,
    );

    return { exists: conflictingId !== undefined };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "read");
  }
}

function parseUserRoleListFilters(searchParams: URLSearchParams): UserRoleListFilters {
  const rawSearch = searchParams.get("search")?.trim() ?? "";
  const rawStatusParam = searchParams.get("status");
  const rawStatus =
    rawStatusParam === null || rawStatusParam.trim() === ""
      ? "all"
      : rawStatusParam.trim();

  if (rawSearch.length > SEARCH_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "search",
        message: `Must be ${SEARCH_MAX_LENGTH} characters or fewer.`,
      },
    ]);
  }

  if (!isUserRoleStatusFilter(rawStatus)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "status",
        message: "Must be one of: active, inactive, all.",
      },
    ]);
  }

  const limit = parseBoundedIntParam(
    searchParams.get("limit"),
    "limit",
    DEFAULT_USER_ROLE_LIST_LIMIT,
    1,
    MAX_USER_ROLE_LIST_LIMIT,
  );
  const offset = parseBoundedIntParam(
    searchParams.get("offset"),
    "offset",
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  return {
    search: rawSearch,
    status: rawStatus,
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

  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field,
        message:
          field === "limit"
            ? `Must be an integer between ${min} and ${max}.`
            : "Must be a non-negative integer.",
      },
    ]);
  }

  return value;
}

function isUserRoleStatusFilter(value: string): value is UserRoleStatusFilter {
  return value === "active" || value === "inactive" || value === "all";
}

function validateCreateUserRoleApiPayload(payload: unknown): UserRoleCreateRowInput {
  if (!isPlainObject(payload)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
    );
  }

  const details: ApiErrorDetail[] = [];

  for (const fieldName of Object.keys(payload)) {
    if (!ALLOWED_CREATE_FIELDS.has(fieldName)) {
      details.push({
        field: fieldName,
        message: "Unsupported field.",
      });
    }
  }

  const label = validateRequiredLabel(payload.label, details);
  const code = validateCreateApiCode(payload.code, details);
  const deactivated_at = validateOptionalDeactivatedAt(
    hasOwnField(payload, "deactivated_at")
      ? payload.deactivated_at
      : null,
    details,
  );

  const permissions = validatePermissionsList(
    hasOwnField(payload, "permissions") ? payload.permissions : [],
    details,
  );

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  return {
    label,
    code,
    deactivated_at,
    permissions,
  };
}

function validateCreateApiCode(
  value: unknown,
  details: ApiErrorDetail[],
): string {
  if (typeof value !== "string") {
    details.push({
      field: "code",
      message: "Must be a string.",
    });

    return "";
  }

  const code = value.trim();

  if (!code) {
    details.push({
      field: "code",
      message: "This field is required.",
    });

    return "";
  }

  if (code.length > CODE_MAX_LENGTH) {
    details.push({
      field: "code",
      message: `Must be ${CODE_MAX_LENGTH} characters or fewer.`,
    });
  }

  if (!CREATE_CODE_PATTERN.test(code)) {
    details.push({
      field: "code",
      message: "Use printable ASCII characters only (no spaces).",
    });
  }

  return code;
}

function validateOptionalDeactivatedAt(
  value: unknown,
  details: ApiErrorDetail[],
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    details.push({
      field: "deactivated_at",
      message: "Must be a string or null.",
    });

    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  const ms = Date.parse(trimmed);

  if (!Number.isFinite(ms)) {
    details.push({
      field: "deactivated_at",
      message: "Must be a valid ISO 8601 datetime.",
    });

    return null;
  }

  return new Date(ms).toISOString();
}

function validateUpdateUserRolePayload(payload: unknown): UpdateUserRoleInput {
  if (!isPlainObject(payload)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
    );
  }

  const details: ApiErrorDetail[] = [];
  const patch: UpdateUserRoleInput = {};

  for (const fieldName of Object.keys(payload)) {
    if (!ALLOWED_UPDATE_FIELDS.has(fieldName)) {
      details.push({
        field: fieldName,
        message: "Unsupported field.",
      });
    }
  }

  if (Object.keys(payload).length === 0) {
    details.push({
      message: "Provide at least one field to update.",
    });
  }

  if (hasOwnField(payload, "label")) {
    patch.label = validateRequiredLabel(payload.label, details);
  }

  if (hasOwnField(payload, "code")) {
    patch.code = validateRequiredCode(payload.code, details);
  }

  if (hasOwnField(payload, "active")) {
    patch.active = validateBoolean(payload.active, "active", details, true);
  }

  if (hasOwnField(payload, "permissions")) {
    patch.permissions = validatePermissionsList(payload.permissions, details);
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  return patch;
}

function validatePermissionsList(
  value: unknown,
  details: ApiErrorDetail[],
): string[] {
  const raw = value === undefined ? [] : value;

  if (!Array.isArray(raw)) {
    details.push({
      field: "permissions",
      message: "Must be an array of permission slugs.",
    });

    return [];
  }

  const next: string[] = [];

  for (const item of raw) {
    if (typeof item !== "string") {
      details.push({
        field: "permissions",
        message: "Each permission must be a string.",
      });

      return [];
    }

    if (!ALL_KNOWN_PERMISSION_SLUGS.has(item)) {
      details.push({
        field: "permissions",
        message: "One or more permission slugs are not recognized.",
      });

      return [];
    }

    next.push(item);
  }

  return [...new Set(next)];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnField(
  value: Record<string, unknown>,
  field: string,
): boolean {
  return Object.hasOwn(value, field);
}

function validateRequiredLabel(
  value: unknown,
  details: ApiErrorDetail[],
): string {
  if (typeof value !== "string") {
    details.push({
      field: "label",
      message: "Must be a string.",
    });

    return "";
  }

  const normalizedLabel = value.trim();

  if (!normalizedLabel) {
    details.push({
      field: "label",
      message: "This field is required.",
    });

    return "";
  }

  if (normalizedLabel.length > LABEL_MAX_LENGTH) {
    details.push({
      field: "label",
      message: `Must be ${LABEL_MAX_LENGTH} characters or fewer.`,
    });
  }

  return normalizedLabel;
}

function validateRequiredCode(
  value: unknown,
  details: ApiErrorDetail[],
): string {
  if (typeof value !== "string") {
    details.push({
      field: "code",
      message: "Must be a string.",
    });

    return "";
  }

  const normalizedCode = value
    .trim()
    .replaceAll(/[\s-]+/g, "_")
    .toUpperCase();

  if (!normalizedCode) {
    details.push({
      field: "code",
      message: "This field is required.",
    });

    return "";
  }

  if (normalizedCode.length > CODE_MAX_LENGTH) {
    details.push({
      field: "code",
      message: `Must be ${CODE_MAX_LENGTH} characters or fewer.`,
    });
  }

  if (!CODE_PATTERN.test(normalizedCode)) {
    details.push({
      field: "code",
      message: "Use uppercase letters, numbers, and underscores only.",
    });
  }

  return normalizedCode;
}

function validateBoolean(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    details.push({
      field,
      message: "Must be a boolean.",
    });

    return defaultValue;
  }

  return value;
}

function parseUserRoleId(userRoleIdValue: string): number {
  const userRoleId = Number(userRoleIdValue);

  if (!Number.isInteger(userRoleId) || userRoleId < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "id",
        message: "User role id must be a positive integer.",
      },
    ]);
  }

  return userRoleId;
}

function createUserRoleNotFoundError(): ApiError {
  return new ApiError(404, "USER_ROLE_NOT_FOUND", "User role not found.");
}

function createUserRoleCodeConflictError(): ApiError {
  return new ApiError(
    409,
    "USER_ROLE_CODE_CONFLICT",
    "A user role with this code already exists.",
    [{ field: "code", message: "This code is already in use." }],
  );
}

async function assertUserRoleCodeNotConflicting(
  code: string,
  excludeUserRoleId?: number,
): Promise<void> {
  try {
    const conflictingId = await findConflictingUserRoleIdByCodeCaseInsensitive(
      code,
      excludeUserRoleId,
    );

    if (conflictingId !== undefined) {
      throw createUserRoleCodeConflictError();
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "read");
  }
}

function translateRepositoryError(
  error: unknown,
  action: "read" | "create" | "update",
): ApiError | Error {
  if (error instanceof ApiError) {
    return error;
  }

  const code = getPostgresErrorCode(error) ?? getDatabaseErrorCode(error);
  const constraint = getPostgresConstraintName(error);
  const nodeCode = getNodeSystemErrorCode(error);

  if (
    nodeCode === "ECONNREFUSED" ||
    nodeCode === "ETIMEDOUT" ||
    nodeCode === "ENOTFOUND"
  ) {
    return new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Database is unavailable.",
    );
  }

  if (code === "42P01") {
    return new ApiError(
      503,
      "USER_ROLE_TABLE_UNAVAILABLE",
      "User role table is not available.",
    );
  }

  if (code === "42703") {
    return new ApiError(
      503,
      "USER_ROLE_SCHEMA_OUT_OF_DATE",
      "The role table is missing a column this API expects (for example label, updated_at, deactivated_at, is_deleted, or permissions). " +
        "The server normally adds these automatically unless RBAC_SKIP_DDL=1. Remove that flag or align columns with the patches in src/repositories/user-role.repository.ts.",
    );
  }

  if ((action === "create" || action === "update") && code === "23505") {
    // Unique on `code` (constraint renamed if table was ever `user_role`).
    if (
      constraint === "rbac_role_code_key" ||
      constraint === "user_role_code_key"
    ) {
      return new ApiError(
        409,
        "USER_ROLE_CODE_CONFLICT",
        "A user role with this code already exists.",
        [
          {
            field: "code",
            message: "This code is already in use.",
          },
        ],
      );
    }

    return new ApiError(
      409,
      "USER_ROLE_ALREADY_EXISTS",
      "A user role with those details already exists.",
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown user role repository error.");
}

/** PG error code from the driver, including wrapped `error.cause` chains. */
function getPostgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object" && current !== null && "code" in current) {
      const raw = (current as { code: unknown }).code;

      if (
        typeof raw === "string" &&
        raw.length === 5 &&
        /^[0-9A-Z]{5}$/.test(raw)
      ) {
        return raw;
      }
    }

    if (current instanceof Error && current.cause !== undefined) {
      current = current.cause;
      continue;
    }

    break;
  }

  return undefined;
}

function getNodeSystemErrorCode(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object" && current !== null && "code" in current) {
      const raw = (current as { code: unknown }).code;

      if (typeof raw === "string" && /^[A-Z0-9_]+$/.test(raw)) {
        return raw;
      }
    }

    if (current instanceof Error && current.cause !== undefined) {
      current = current.cause;
      continue;
    }

    break;
  }

  return undefined;
}

/** @deprecated Prefer getPostgresErrorCode; kept for callers that need non-PG `code`. */
function getDatabaseErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}

function getPostgresConstraintName(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "constraint" in current &&
      typeof (current as { constraint: unknown }).constraint === "string"
    ) {
      return (current as { constraint: string }).constraint;
    }

    if (current instanceof Error && current.cause !== undefined) {
      current = current.cause;
      continue;
    }

    break;
  }

  return undefined;
}
