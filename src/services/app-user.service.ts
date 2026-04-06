import { randomInt } from "node:crypto";
import argon2 from "argon2";
import { ApiError, type ApiErrorDetail } from "@/lib/api/errors";
import {
  countAppUserRows,
  findConflictingAppUserIdByEmailCaseInsensitive,
  getAppUserRowById,
  insertAppUserRow,
  listAppUserOptionRows,
  listAppUserRows,
  markAppUserRowDeleted,
  updateAppUserRowWithOptionalPasswordHash,
} from "@/repositories/app-user.repository";
import {
  ensureRbacRoleSchemaPatches,
  getUserRoleRowById,
} from "@/repositories/user-role.repository";
import {
  normalizeAppUserApiRecord,
  normalizeAppUserRowTimestamps,
  toAppUserApiRecord,
  type AppUserApiRecord,
  type AppUserListFilters,
  type AppUserOptionRow,
  type AppUserRow,
  type AppUserStatusFilter,
  type CreateAppUserInput,
  type UpdateAppUserInput,
} from "@/modules/app-user/types";
import { recordAuditEvent } from "@/services/audit-log.service";

const ALLOWED_CREATE_FIELDS = new Set([
  "active",
  "deactivated_at",
  "email",
  "full_name",
  "password",
  "role_id",
  "use_custom_password",
]);
const ALLOWED_UPDATE_FIELDS = new Set([
  "active",
  "email",
  "full_name",
  "password",
  "role_id",
]);

const EMAIL_MAX_LENGTH = 254;
const FULL_NAME_MAX_LENGTH = 200;
const SEARCH_MAX_LENGTH = 100;
const DEFAULT_APP_USER_LIST_LIMIT = 20;
const MAX_APP_USER_LIST_LIMIT = 500;
const APP_USER_PASSWORD_MIN_LENGTH = 12;
const APP_USER_PASSWORD_MAX_LENGTH = 128;
const APP_USER_GENERATED_PASSWORD_LENGTH = 12;
const APP_USER_GENERATED_PASSWORD_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// SEC: Reasonable email shape check; full validation is server-side normalization + uniqueness.
const EMAIL_SHAPE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AppUserListPage = {
  data: AppUserApiRecord[];
  pagination: { limit: number; offset: number; total: number };
};

function appUserRowToApiRecord(row: AppUserRow): AppUserApiRecord {
  return normalizeAppUserApiRecord(
    toAppUserApiRecord(normalizeAppUserRowTimestamps(row)),
  );
}

export async function listAppUsersPage(
  input: URLSearchParams | AppUserListFilters,
): Promise<AppUserListPage> {
  const filters =
    input instanceof URLSearchParams ? parseAppUserListFilters(input) : input;

  try {
    const [total, rows] = await Promise.all([
      countAppUserRows(filters),
      listAppUserRows(filters),
    ]);

    return {
      data: rows.map(appUserRowToApiRecord),
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

export async function listAppUserOptions(): Promise<AppUserOptionRow[]> {
  try {
    return await listAppUserOptionRows();
  } catch (error) {
    throw translateRepositoryError(error, "read");
  }
}

type ValidatedCreateAppUser = {
  email: string;
  full_name: string;
  role_id: number;
  deactivated_at: string | null;
  passwordPlainForHash: string;
  generatedPasswordPlain: string | null;
};

export type CreateAppUserResult = {
  user: AppUserApiRecord;
  /** SEC: Plain password returned once when the server generated it; never logged. */
  generatedPassword: string | null;
  successMessage: string;
};

export async function createAppUser(
  payload: unknown,
): Promise<CreateAppUserResult> {
  const input = validateCreateAppUserPayload(payload);

  try {
    await assertRoleExists(input.role_id);
    await assertAppUserEmailNotConflicting(input.email);

    let password_hash: string;
    try {
      // SEC: Argon2id for password storage; never log the plain secret.
      password_hash = await argon2.hash(input.passwordPlainForHash, {
        type: argon2.argon2id,
      });
    } catch (hashError) {
      console.error("app-user: argon2.hash failed", hashError);
      throw new ApiError(
        500,
        "PASSWORD_HASH_FAILED",
        "Could not process the password. Try again or create the user without a custom password.",
      );
    }

    const row = await insertAppUserRow(
      {
        email: normalizeEmail(input.email),
        full_name: input.full_name.trim(),
        role_id: input.role_id,
        deactivated_at: input.deactivated_at,
      },
      password_hash,
    );
    const user = appUserRowToApiRecord(row);

    await recordAuditEvent({
      action: "app_user.create",
      entity: "app_user",
      entityId: user.id,
      permission: "users.write",
    });

    await recordAuditEvent({
      action: "auth.create",
      entity: "auth",
      entityId: user.id,
      permission: "users.write",
    });

    return {
      user,
      generatedPassword: input.generatedPasswordPlain,
      successMessage: "User created",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "create");
  }
}

export async function getAppUser(appUserIdValue: string): Promise<AppUserApiRecord> {
  const appUserId = parseAppUserId(appUserIdValue);

  try {
    const row = await getAppUserRowById(appUserId);

    if (!row) {
      throw createAppUserNotFoundError();
    }

    return appUserRowToApiRecord(row);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "read");
  }
}

export async function updateAppUser(
  appUserIdValue: string,
  payload: unknown,
): Promise<AppUserApiRecord> {
  const appUserId = parseAppUserId(appUserIdValue);
  const patch = validateUpdateAppUserPayload(payload);
  const { password: newPasswordPlain, ...patchForMerge } = patch;

  try {
    const existingRow = await getAppUserRowById(appUserId);

    if (!existingRow) {
      throw createAppUserNotFoundError();
    }

    if (existingRow.is_default) {
      assertDefaultAppUserPatchAllowed(existingRow, patch);
    }

    const merged = mergeAppUserUpdate(existingRow, patchForMerge);

    if (patchForMerge.role_id !== undefined) {
      await assertRoleExists(merged.role_id);
    }

    if (patchForMerge.email !== undefined) {
      await assertAppUserEmailNotConflicting(merged.email, appUserId);
    }

    let passwordHash: string | null = null;

    if (newPasswordPlain !== undefined) {
      try {
        passwordHash = await argon2.hash(newPasswordPlain, {
          type: argon2.argon2id,
        });
      } catch (hashError) {
        console.error("app-user: argon2.hash (update) failed", hashError);
        throw new ApiError(
          500,
          "PASSWORD_HASH_FAILED",
          "Could not process the password. Try again.",
        );
      }
    }

    const updatedRow = await updateAppUserRowWithOptionalPasswordHash(
      appUserId,
      merged,
      passwordHash,
    );

    if (!updatedRow) {
      throw createAppUserNotFoundError();
    }

    if (newPasswordPlain !== undefined) {
      await recordAuditEvent({
        action: "auth.password_update",
        entity: "auth",
        entityId: appUserId,
        permission: "users.write",
      });
    }

    return appUserRowToApiRecord(updatedRow);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "update");
  }
}

export async function markAppUserDeleted(
  appUserIdValue: string,
): Promise<AppUserApiRecord> {
  const appUserId = parseAppUserId(appUserIdValue);

  try {
    const existing = await getAppUserRowById(appUserId);

    if (!existing) {
      throw createAppUserNotFoundError();
    }

    if (existing.is_default) {
      throw new ApiError(
        403,
        "APP_USER_PROTECTED",
        "This user cannot be deleted.",
      );
    }

    const row = await markAppUserRowDeleted(appUserId);

    if (!row) {
      throw createAppUserNotFoundError();
    }

    return appUserRowToApiRecord(row);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "update");
  }
}

export type AppUserEmailExistsResult = {
  exists: boolean;
};

export async function checkAppUserEmailExists(
  searchParams: URLSearchParams,
): Promise<AppUserEmailExistsResult> {
  const emailRaw = searchParams.get("email") ?? "";
  if (emailRaw.trim() === "") {
    return { exists: false };
  }

  const excludeRaw = searchParams.get("exclude_id");
  let excludeId: number | undefined;
  if (excludeRaw !== null && excludeRaw.trim() !== "") {
    excludeId = parseAppUserId(excludeRaw.trim());
  }

  const details: ApiErrorDetail[] = [];
  const normalized = validateEmailForLookup(emailRaw, details);

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  if (!normalized) {
    return { exists: false };
  }

  try {
    const conflictingId = await findConflictingAppUserIdByEmailCaseInsensitive(
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

function parseAppUserListFilters(
  searchParams: URLSearchParams,
): AppUserListFilters {
  const rawSearch = searchParams.get("search")?.trim() ?? "";
  const rawStatusParam = searchParams.get("status");
  const rawStatus =
    rawStatusParam === null || rawStatusParam.trim() === ""
      ? "all"
      : rawStatusParam.trim();
  const rawRoleId = searchParams.get("role_id")?.trim() ?? "";

  if (rawSearch.length > SEARCH_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "search",
        message: `Must be ${SEARCH_MAX_LENGTH} characters or fewer.`,
      },
    ]);
  }

  if (!isAppUserStatusFilter(rawStatus)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "status",
        message: "Must be one of: active, inactive, all.",
      },
    ]);
  }

  let role_id: number | undefined;
  if (rawRoleId !== "" && rawRoleId !== "all") {
    const parsed = Number.parseInt(rawRoleId, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "role_id",
          message: "Must be a positive integer or omitted.",
        },
      ]);
    }
    role_id = parsed;
  }

  const limit = parseBoundedIntParam(
    searchParams.get("limit"),
    "limit",
    DEFAULT_APP_USER_LIST_LIMIT,
    1,
    MAX_APP_USER_LIST_LIMIT,
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
    role_id,
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

function isAppUserStatusFilter(value: string): value is AppUserStatusFilter {
  return value === "active" || value === "inactive" || value === "all";
}

function generateSecurePassword(): string {
  let out = "";
  for (let i = 0; i < APP_USER_GENERATED_PASSWORD_LENGTH; i += 1) {
    out +=
      APP_USER_GENERATED_PASSWORD_ALPHABET[
        randomInt(APP_USER_GENERATED_PASSWORD_ALPHABET.length)
      ];
  }
  return out;
}

function validateOptionalDeactivatedAtCreate(
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

function resolveCreateDeactivatedAt(
  payload: Record<string, unknown>,
  details: ApiErrorDetail[],
): string | null {
  if (hasOwnField(payload, "deactivated_at")) {
    return validateOptionalDeactivatedAtCreate(
      payload.deactivated_at,
      details,
    );
  }

  if (hasOwnField(payload, "active")) {
    const active = validateBoolean(payload.active, "active", details, true);
    return active ? null : new Date().toISOString();
  }

  return null;
}

function parseExplicitCreatePassword(
  payload: Record<string, unknown>,
  details: ApiErrorDetail[],
): string | null {
  if (!hasOwnField(payload, "password")) {
    return null;
  }

  const value = payload.password;

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    details.push({
      field: "password",
      message: "Must be a string.",
    });
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > APP_USER_PASSWORD_MAX_LENGTH) {
    details.push({
      field: "password",
      message: `Must be ${APP_USER_PASSWORD_MAX_LENGTH} characters or fewer.`,
    });
    return null;
  }

  if (trimmed.length < APP_USER_PASSWORD_MIN_LENGTH) {
    details.push({
      field: "password",
      message: `Must be at least ${APP_USER_PASSWORD_MIN_LENGTH} characters.`,
    });
    return null;
  }

  return trimmed;
}

function validateRequiredUpdatePassword(
  value: unknown,
  details: ApiErrorDetail[],
): string | undefined {
  if (value === null || value === undefined) {
    details.push({
      field: "password",
      message: "Must be a string.",
    });
    return undefined;
  }

  if (typeof value !== "string") {
    details.push({
      field: "password",
      message: "Must be a string.",
    });
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    details.push({
      field: "password",
      message: "Enter a new password.",
    });
    return undefined;
  }

  if (trimmed.length > APP_USER_PASSWORD_MAX_LENGTH) {
    details.push({
      field: "password",
      message: `Must be ${APP_USER_PASSWORD_MAX_LENGTH} characters or fewer.`,
    });
    return undefined;
  }

  if (trimmed.length < APP_USER_PASSWORD_MIN_LENGTH) {
    details.push({
      field: "password",
      message: `Must be at least ${APP_USER_PASSWORD_MIN_LENGTH} characters.`,
    });
    return undefined;
  }

  return trimmed;
}

function validateCreateAppUserPayload(
  payload: unknown,
): ValidatedCreateAppUser {
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

  const email = validateRequiredEmail(payload.email, details);
  const full_name = validateRequiredFullName(payload.full_name, details);
  const role_id = validateRequiredRoleId(payload.role_id, details);
  const deactivated_at = resolveCreateDeactivatedAt(payload, details);

  const explicitPassword = parseExplicitCreatePassword(payload, details);

  const useCustomPassword = hasOwnField(payload, "use_custom_password")
    ? validateBoolean(
        payload.use_custom_password,
        "use_custom_password",
        details,
        false,
      )
    : undefined;

  let passwordPlainForHash: string;
  let generatedPasswordPlain: string | null = null;

  if (explicitPassword !== null) {
    passwordPlainForHash = explicitPassword;
  } else if (useCustomPassword === true) {
    if (!details.some((d) => d.field === "password")) {
      details.push({
        field: "password",
        message: "Password is required when use_custom_password is true.",
      });
    }
    passwordPlainForHash = "";
  } else {
    const gen = generateSecurePassword();
    passwordPlainForHash = gen;
    generatedPasswordPlain = gen;
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  return {
    email,
    full_name,
    role_id,
    deactivated_at,
    passwordPlainForHash,
    generatedPasswordPlain,
  };
}

function validateUpdateAppUserPayload(payload: unknown): UpdateAppUserInput {
  if (!isPlainObject(payload)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
    );
  }

  const details: ApiErrorDetail[] = [];
  const patch: UpdateAppUserInput = {};

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

  if (hasOwnField(payload, "email")) {
    patch.email = validateRequiredEmail(payload.email, details);
  }

  if (hasOwnField(payload, "full_name")) {
    patch.full_name = validateRequiredFullName(payload.full_name, details);
  }

  if (hasOwnField(payload, "role_id")) {
    patch.role_id = validateRequiredRoleId(payload.role_id, details);
  }

  if (hasOwnField(payload, "active")) {
    patch.active = validateBoolean(payload.active, "active", details, true);
  }

  if (hasOwnField(payload, "password")) {
    const pwd = validateRequiredUpdatePassword(payload.password, details);

    if (pwd !== undefined) {
      patch.password = pwd;
    }
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  return patch;
}

function mergeAppUserUpdate(
  existing: AppUserRow,
  patch: UpdateAppUserInput,
): CreateAppUserInput {
  const base = rowToCreateInput(existing);

  return {
    email: patch.email !== undefined ? normalizeEmail(patch.email) : base.email,
    full_name:
      patch.full_name !== undefined
        ? patch.full_name.trim()
        : base.full_name,
    role_id: patch.role_id !== undefined ? patch.role_id : base.role_id,
    active: patch.active !== undefined ? patch.active : base.active,
  };
}

function rowToCreateInput(row: AppUserRow): CreateAppUserInput {
  return {
    email: normalizeEmail(row.email),
    full_name: row.full_name.trim(),
    role_id: row.role_id,
    active: row.deactivated_at === null,
  };
}

function assertDefaultAppUserPatchAllowed(
  existing: AppUserRow,
  patch: UpdateAppUserInput,
): void {
  const existingActive = existing.deactivated_at === null;

  if (
    patch.email !== undefined &&
    normalizeEmail(patch.email) !== normalizeEmail(existing.email)
  ) {
    throw protectedUserError();
  }

  if (
    patch.full_name !== undefined &&
    patch.full_name.trim() !== existing.full_name.trim()
  ) {
    throw protectedUserError();
  }

  if (patch.role_id !== undefined && patch.role_id !== existing.role_id) {
    throw protectedUserError();
  }

  if (
    patch.active !== undefined &&
    patch.active !== existingActive
  ) {
    throw protectedUserError();
  }
}

function protectedUserError(): ApiError {
  return new ApiError(
    403,
    "APP_USER_PROTECTED",
    "This system user cannot be modified.",
  );
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateEmailForLookup(
  value: string,
  details: ApiErrorDetail[],
): string | undefined {
  const email = validateRequiredEmail(value, details);
  return email === "" ? undefined : normalizeEmail(email);
}

function validateRequiredEmail(
  value: unknown,
  details: ApiErrorDetail[],
): string {
  if (typeof value !== "string") {
    details.push({
      field: "email",
      message: "Must be a string.",
    });
    return "";
  }

  const trimmed = value.trim();

  if (!trimmed) {
    details.push({
      field: "email",
      message: "This field is required.",
    });
    return "";
  }

  if (trimmed.length > EMAIL_MAX_LENGTH) {
    details.push({
      field: "email",
      message: `Must be ${EMAIL_MAX_LENGTH} characters or fewer.`,
    });
  }

  if (!EMAIL_SHAPE_PATTERN.test(trimmed)) {
    details.push({
      field: "email",
      message: "Must be a valid email address.",
    });
  }

  return trimmed;
}

function validateRequiredFullName(
  value: unknown,
  details: ApiErrorDetail[],
): string {
  if (typeof value !== "string") {
    details.push({
      field: "full_name",
      message: "Must be a string.",
    });
    return "";
  }

  const trimmed = value.trim();

  if (!trimmed) {
    details.push({
      field: "full_name",
      message: "This field is required.",
    });
    return "";
  }

  if (trimmed.length > FULL_NAME_MAX_LENGTH) {
    details.push({
      field: "full_name",
      message: `Must be ${FULL_NAME_MAX_LENGTH} characters or fewer.`,
    });
  }

  return trimmed;
}

function validateRequiredRoleId(
  value: unknown,
  details: ApiErrorDetail[],
): number {
  if (typeof value !== "number" && typeof value !== "string") {
    details.push({
      field: "role_id",
      message: "Must be a number.",
    });
    return 0;
  }

  const raw = typeof value === "number" ? String(value) : value.trim();
  const n = Number.parseInt(raw, 10);

  if (!Number.isInteger(n) || n < 1) {
    details.push({
      field: "role_id",
      message: "Must be a positive integer.",
    });
    return 0;
  }

  return n;
}

function validateBoolean(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
  defaultValue: boolean,
): boolean {
  if (typeof value !== "boolean") {
    details.push({
      field,
      message: "Must be a boolean.",
    });
    return defaultValue;
  }

  return value;
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

function parseAppUserId(appUserIdValue: string): number {
  const appUserId = Number.parseInt(appUserIdValue, 10);

  if (!Number.isInteger(appUserId) || appUserId < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "id",
        message: "User id must be a positive integer.",
      },
    ]);
  }

  return appUserId;
}

function createAppUserNotFoundError(): ApiError {
  return new ApiError(404, "APP_USER_NOT_FOUND", "User not found.");
}

async function assertRoleExists(roleId: number): Promise<void> {
  await ensureRbacRoleSchemaPatches();

  const role = await getUserRoleRowById(roleId);

  if (!role) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "role_id",
        message: "Role not found.",
      },
    ]);
  }
}

async function assertAppUserEmailNotConflicting(
  email: string,
  excludeAppUserId?: number,
): Promise<void> {
  try {
    const conflictingId = await findConflictingAppUserIdByEmailCaseInsensitive(
      normalizeEmail(email),
      excludeAppUserId,
    );

    if (conflictingId !== undefined) {
      throw new ApiError(
        409,
        "APP_USER_EMAIL_CONFLICT",
        "A user with this email already exists.",
        [{ field: "email", message: "This email is already in use." }],
      );
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
): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const code =
    getPostgresErrorCode(error) ?? getLegacyDatabaseErrorCode(error);
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
      "APP_USER_TABLE_UNAVAILABLE",
      "Users table is not available.",
    );
  }

  if (code === "42703") {
    const column = getPostgresColumnName(error);
    const ddlHint =
      process.env.RBAC_SKIP_DDL === "1"
        ? " RBAC_SKIP_DDL=1 is set, so the app will not run schema patches; remove it or align the database with the DDL in src/repositories/app-user.repository.ts and user-role.repository.ts."
        : " If this persists, ensure the database matches the DDL applied by those repositories at startup, or check server logs for the failing query.";
    return new ApiError(
      503,
      "APP_USER_SCHEMA_MISMATCH",
      column
        ? `Database schema mismatch: missing column "${column}".${ddlHint}`
        : `Database schema does not match this API (undefined column).${ddlHint}`,
    );
  }

  if ((action === "create" || action === "update") && code === "23503") {
    return new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "role_id",
        message: "Role does not exist or cannot be referenced.",
      },
    ]);
  }

  if ((action === "create" || action === "update") && code === "23505") {
    if (
      constraint === "idx_app_user_email_lower" ||
      constraint === "app_user_email_key"
    ) {
      return new ApiError(
        409,
        "APP_USER_EMAIL_CONFLICT",
        "A user with this email already exists.",
        [{ field: "email", message: "This email is already in use." }],
      );
    }

    return new ApiError(
      409,
      "APP_USER_ALREADY_EXISTS",
      "A user with those details already exists.",
    );
  }

  console.error("app-user: unhandled database error", error);

  return new ApiError(
    500,
    "APP_USER_DATABASE_ERROR",
    "Could not complete the request. Check server logs.",
  );
}

/** PG error code from the driver, including wrapped `error.cause` chains. */
function getPostgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;

  for (
    let depth = 0;
    depth < 8 && current !== null && current !== undefined;
    depth += 1
  ) {
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

function getPostgresConstraintName(error: unknown): string | undefined {
  let current: unknown = error;

  for (
    let depth = 0;
    depth < 8 && current !== null && current !== undefined;
    depth += 1
  ) {
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

function columnNameFromPostgresMessage(message: string): string | undefined {
  const quoted = /column "([^"]+)"/i.exec(message);
  if (quoted?.[1]) {
    return quoted[1];
  }

  const unquoted = /column (\w+) does not exist/i.exec(message);
  return unquoted?.[1];
}

function getPostgresColumnName(error: unknown): string | undefined {
  let current: unknown = error;

  for (
    let depth = 0;
    depth < 8 && current !== null && current !== undefined;
    depth += 1
  ) {
    if (typeof current === "object" && current !== null) {
      const col = (current as { column?: unknown }).column;
      if (typeof col === "string" && col.length > 0) {
        return col;
      }

      const message =
        current instanceof Error ? current.message : undefined;
      if (typeof message === "string") {
        const fromMessage = columnNameFromPostgresMessage(message);
        if (fromMessage !== undefined) {
          return fromMessage;
        }
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

  for (
    let depth = 0;
    depth < 8 && current !== null && current !== undefined;
    depth += 1
  ) {
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

function getLegacyDatabaseErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }

  return undefined;
}
