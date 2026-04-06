import { ApiError, type ApiErrorDetail } from "@/lib/api/errors";
import {
  countGenderRows,
  findConflictingGenderIdByCodeCaseInsensitive,
  getGenderRowById,
  insertGenderRow,
  listGenderRows,
  markGenderRowDeleted,
  updateGenderRow,
} from "@/repositories/gender.repository";
import {
  mapGenderRowToCreateGenderInput,
  normalizeGenderRowTimestamps,
  type CreateGenderInput,
  type GenderCreateRowInput,
  type GenderListFilters,
  type GenderRow,
  type GenderStatusFilter,
  type UpdateGenderInput,
} from "@/modules/gender/types";
import { recordAuditEvent } from "@/services/audit-log.service";

const ALLOWED_CREATE_FIELDS = new Set(["code", "deactivated_at", "label"]);
const ALLOWED_UPDATE_FIELDS = new Set(["active", "code", "label"]);
const CODE_MAX_LENGTH = 50;
const LABEL_MAX_LENGTH = 100;
const SEARCH_MAX_LENGTH = 100;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
// SEC: Printable ASCII only for create codes (no control chars / unicode tricks).
const CREATE_CODE_PATTERN = /^[\x21-\x7E]+$/;
const DEFAULT_GENDER_LIST_LIMIT = 20;
// SEC: Caps page size to limit DoS via huge LIMIT queries; lookups use status=active + high limit.
const MAX_GENDER_LIST_LIMIT = 500;

export type GenderListPage = {
  data: GenderRow[];
  pagination: { limit: number; offset: number; total: number };
};

export async function listGendersPage(
  input: URLSearchParams | GenderListFilters,
): Promise<GenderListPage> {
  const filters =
    input instanceof URLSearchParams ? parseGenderListFilters(input) : input;

  try {
    const [total, rows] = await Promise.all([
      countGenderRows(filters),
      listGenderRows(filters),
    ]);

    return {
      data: rows.map(normalizeGenderRowTimestamps),
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

export async function createGender(payload: unknown): Promise<GenderRow> {
  const input = validateCreateGenderApiPayload(payload);

  try {
    await assertGenderCodeNotConflicting(input.code);

    const row = await insertGenderRow(input);
    const normalizedRow = normalizeGenderRowTimestamps(row);

    await recordAuditEvent({
      action: "gender.create",
      entity: "gender",
      entityId: normalizedRow.id,
      permission: "genders.write",
    });

    return normalizedRow;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "create");
  }
}

export async function getGender(genderIdValue: string): Promise<GenderRow> {
  const genderId = parseGenderId(genderIdValue);

  try {
    const row = await getGenderRowById(genderId);

    if (!row) {
      throw createGenderNotFoundError();
    }

    return normalizeGenderRowTimestamps(row);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "read");
  }
}

export async function updateGender(
  genderIdValue: string,
  payload: unknown,
): Promise<GenderRow> {
  const genderId = parseGenderId(genderIdValue);
  const patch = validateUpdateGenderPayload(payload);

  try {
    const existingRow = await getGenderRowById(genderId);

    if (!existingRow) {
      throw createGenderNotFoundError();
    }

    const input: CreateGenderInput = {
      ...mapGenderRowToCreateGenderInput(existingRow),
      ...patch,
    };

    if (patch.code !== undefined) {
      await assertGenderCodeNotConflicting(input.code, genderId);
    }

    const updatedRow = await updateGenderRow(genderId, input);

    if (!updatedRow) {
      throw createGenderNotFoundError();
    }

    const normalizedExisting = normalizeGenderRowTimestamps(existingRow);
    const normalizedUpdated = normalizeGenderRowTimestamps(updatedRow);

    await recordAuditEvent({
      action: "gender.update",
      entity: "gender",
      entityId: normalizedUpdated.id,
      permission: "genders.write",
      before: normalizedExisting,
      after: normalizedUpdated,
    });

    return normalizedUpdated;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "update");
  }
}

export async function markGenderDeleted(
  genderIdValue: string,
): Promise<GenderRow> {
  const genderId = parseGenderId(genderIdValue);

  try {
    const existingRow = await getGenderRowById(genderId);

    if (!existingRow) {
      throw createGenderNotFoundError();
    }

    const row = await markGenderRowDeleted(genderId);

    if (!row) {
      throw createGenderNotFoundError();
    }

    const normalizedRow = normalizeGenderRowTimestamps(row);

    await recordAuditEvent({
      action: "gender.delete",
      entity: "gender",
      entityId: normalizedRow.id,
      permission: "genders.delete",
      before: normalizeGenderRowTimestamps(existingRow),
    });

    return normalizedRow;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "update");
  }
}

/** `exists` is true when another non-deleted row already uses this code (case-insensitive). */
export type GenderCodeExistsResult = {
  exists: boolean;
};

/** Sec: Same case-insensitive rules as create/update; empty input skips DB (no error while clearing field). */
export async function checkGenderCodeExists(
  searchParams: URLSearchParams,
): Promise<GenderCodeExistsResult> {
  const codeRaw = searchParams.get("code") ?? "";
  if (codeRaw.trim() === "") {
    return { exists: false };
  }

  const excludeRaw = searchParams.get("exclude_id");
  let excludeId: number | undefined;
  if (excludeRaw !== null && excludeRaw.trim() !== "") {
    excludeId = parseGenderId(excludeRaw.trim());
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
    const conflictingId = await findConflictingGenderIdByCodeCaseInsensitive(
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

function parseGenderListFilters(searchParams: URLSearchParams): GenderListFilters {
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

  if (!isGenderStatusFilter(rawStatus)) {
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
    DEFAULT_GENDER_LIST_LIMIT,
    1,
    MAX_GENDER_LIST_LIMIT,
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

function isGenderStatusFilter(value: string): value is GenderStatusFilter {
  return value === "active" || value === "inactive" || value === "all";
}

function validateCreateGenderApiPayload(payload: unknown): GenderCreateRowInput {
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

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  return {
    label,
    code,
    deactivated_at,
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

function validateUpdateGenderPayload(payload: unknown): UpdateGenderInput {
  if (!isPlainObject(payload)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
    );
  }

  const details: ApiErrorDetail[] = [];
  const patch: UpdateGenderInput = {};

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

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  return patch;
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

function parseGenderId(genderIdValue: string): number {
  const genderId = Number(genderIdValue);

  if (!Number.isInteger(genderId) || genderId < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "id",
        message: "Gender id must be a positive integer.",
      },
    ]);
  }

  return genderId;
}

function createGenderNotFoundError(): ApiError {
  return new ApiError(404, "GENDER_NOT_FOUND", "Gender not found.");
}

function createGenderCodeConflictError(): ApiError {
  return new ApiError(
    409,
    "GENDER_CODE_CONFLICT",
    "A gender with this code already exists.",
    [{ field: "code", message: "This code is already in use." }],
  );
}

async function assertGenderCodeNotConflicting(
  code: string,
  excludeGenderId?: number,
): Promise<void> {
  try {
    const conflictingId = await findConflictingGenderIdByCodeCaseInsensitive(
      code,
      excludeGenderId,
    );

    if (conflictingId !== undefined) {
      throw createGenderCodeConflictError();
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
  const code = getDatabaseErrorCode(error);
  const constraint = getDatabaseConstraintName(error);

  if (code === "42P01") {
    return new ApiError(
      503,
      "GENDER_TABLE_UNAVAILABLE",
      "Gender table is not available.",
    );
  }

  if ((action === "create" || action === "update") && code === "23505") {
    if (constraint === "gender_code_key") {
      return new ApiError(
        409,
        "GENDER_CODE_CONFLICT",
        "A gender with this code already exists.",
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
      "GENDER_ALREADY_EXISTS",
      "A gender with those details already exists.",
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown gender repository error.");
}

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

function getDatabaseConstraintName(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "constraint" in error &&
    typeof error.constraint === "string"
  ) {
    return error.constraint;
  }

  return undefined;
}
