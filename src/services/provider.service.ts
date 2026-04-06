import { ApiError, type ApiErrorDetail } from "@/lib/api/errors";
import type {
  CreateProviderInput,
  ProviderApiRecord,
  ProviderListFilters,
  UpdateProviderInput,
} from "@/modules/provider/types";
import {
  countProviderRows,
  getProviderRowById,
  insertProviderRow,
  listProviderRows,
  softDeleteProviderRow,
  updateProviderRow,
} from "@/repositories/provider.repository";
import { recordAuditEvent } from "@/services/audit-log.service";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 500;
const SEARCH_MAX_LENGTH = 200;
const ABN_DIGITS = 11;
const NAME_MAX_LENGTH = 200;
const EMAIL_MAX_LENGTH = 254;
const PHONE_MIN_DIGITS = 3;
const PHONE_MAX_DIGITS = 16;
const ADDRESS_MAX_LENGTH = 500;
const UNIT_MAX_LENGTH = 100;

const MSG_EMAIL_INVALID =
  "Please enter a valid email (e.g., name@example.com)";
const MSG_PHONE_INVALID = `Phone number must be ${PHONE_MIN_DIGITS}–${PHONE_MAX_DIGITS} digits.`;
const MSG_ABN_INVALID = "ABN must contain digits only and be 11 digits or fewer.";
const MSG_OPTIONAL_NON_EMPTY =
  "If provided, this field cannot be empty or whitespace only.";

const ALLOWED_CREATE_FIELDS = new Set([
  "abn",
  "name",
  "email",
  "phone_number",
  "address",
  "unit_building",
  "active",
  /** SEC: Accept API-shaped bodies; only null is allowed (same as active). */
  "deactivated_at",
]);

const ALLOWED_UPDATE_FIELDS = new Set([
  "abn",
  "name",
  "email",
  "phone_number",
  "address",
  "unit_building",
  "active",
  "deactivated_at",
]);

export type ProviderListPage = {
  data: ProviderApiRecord[];
  pagination: { limit: number; offset: number; total: number };
};

export async function listProvidersPage(
  searchParams: URLSearchParams,
): Promise<ProviderListPage> {
  const filters = parseProviderListFilters(searchParams);

  try {
    const [total, rows] = await Promise.all([
      countProviderRows(filters),
      listProviderRows(filters),
    ]);

    return {
      data: rows,
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

export async function getProvider(providerIdValue: string): Promise<ProviderApiRecord> {
  const providerId = parseProviderId(providerIdValue);

  try {
    const row = await getProviderRowById(providerId);

    if (!row) {
      throw createProviderNotFoundError();
    }

    return row;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "read");
  }
}

export async function createProvider(payload: unknown): Promise<ProviderApiRecord> {
  const input = validateCreateProviderPayload(payload);

  try {
    const provider = await insertProviderRow(input);

    await recordAuditEvent({
      action: "provider.create",
      entity: "provider",
      entityId: provider.id,
      permission: "providers.write",
    });

    return provider;
  } catch (error) {
    throw translateRepositoryError(error, "create");
  }
}

export async function updateProvider(
  providerIdValue: string,
  payload: unknown,
): Promise<ProviderApiRecord> {
  const providerId = parseProviderId(providerIdValue);
  const patch = validateUpdateProviderPayload(payload);

  try {
    const existing = await getProviderRowById(providerId);

    if (!existing) {
      throw createProviderNotFoundError();
    }

    const merged = mergeProviderUpdate(existing, patch);
    const row = await updateProviderRow(providerId, merged);

    if (!row) {
      throw createProviderNotFoundError();
    }

    await recordAuditEvent({
      action: "provider.update",
      entity: "provider",
      entityId: row.id,
      permission: "providers.write",
      before: existing,
      after: row,
    });

    return row;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "update");
  }
}

export async function deleteProvider(
  providerIdValue: string,
): Promise<{ id: number; deleted_at: string }> {
  const providerId = parseProviderId(providerIdValue);

  try {
    const existing = await getProviderRowById(providerId);

    if (!existing) {
      throw createProviderNotFoundError();
    }

    const result = await softDeleteProviderRow(providerId);

    if (!result) {
      throw createProviderNotFoundError();
    }

    await recordAuditEvent({
      action: "provider.delete",
      entity: "provider",
      entityId: result.id,
      permission: "providers.delete",
      before: existing,
    });

    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "delete");
  }
}

function parseProviderListFilters(searchParams: URLSearchParams): ProviderListFilters {
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

  if (!isProviderStatusFilter(rawStatus)) {
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

  return {
    search: rawSearch,
    status: rawStatus,
    limit,
    offset,
  };
}

function isProviderStatusFilter(
  value: string,
): value is ProviderListFilters["status"] {
  return value === "active" || value === "inactive" || value === "all";
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
      {
        field,
        message: `Must be an integer between ${min} and ${max}.`,
      },
    ]);
  }

  return parsed;
}

function parseProviderId(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "id",
        message: "Provider id must be a positive integer.",
      },
    ]);
  }

  return parsed;
}

function createProviderNotFoundError(): ApiError {
  return new ApiError(404, "PROVIDER_NOT_FOUND", "Provider not found.");
}

function validateCreateProviderPayload(payload: unknown): CreateProviderInput {
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

  const abn = validateRequiredAbn(payload.abn, details);
  const name = validateRequiredString(payload.name, "name", details, NAME_MAX_LENGTH);
  const email = validateRequiredEmail(payload.email, details);
  const phone_number = validateOptionalPhoneNumber(payload.phone_number, details);
  const address = validateOptionalTrimmedNonEmpty(
    payload.address,
    "address",
    details,
    ADDRESS_MAX_LENGTH,
  );
  const unit_building = validateOptionalTrimmedNonEmpty(
    payload.unit_building,
    "unit_building",
    details,
    UNIT_MAX_LENGTH,
  );
  const active = hasOwnField(payload, "active")
    ? validateBoolean(payload.active, "active", details, true)
    : true;

  if (hasOwnField(payload, "deactivated_at")) {
    if (payload.deactivated_at !== null) {
      details.push({
        field: "deactivated_at",
        message:
          'On create, omit this field or set it to null. Use "active": false to create an inactive provider.',
      });
    } else if (!active) {
      details.push({
        field: "deactivated_at",
        message:
          '"deactivated_at": null means active; it cannot be combined with "active": false.',
      });
    }
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  return {
    abn: abn!,
    name: name!,
    email: email!,
    phone_number,
    address,
    unit_building,
    active,
  };
}

function validateUpdateProviderPayload(payload: unknown): UpdateProviderInput {
  if (!isPlainObject(payload)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
    );
  }

  const details: ApiErrorDetail[] = [];
  const patch: UpdateProviderInput = {};

  for (const fieldName of Object.keys(payload)) {
    if (!ALLOWED_UPDATE_FIELDS.has(fieldName)) {
      details.push({
        field: fieldName,
        message: "Unsupported field.",
      });
    }
  }

  if (hasOwnField(payload, "abn")) {
    patch.abn = validateRequiredAbn(payload.abn, details);
  }

  if (hasOwnField(payload, "name")) {
    patch.name = validateRequiredString(
      payload.name,
      "name",
      details,
      NAME_MAX_LENGTH,
    );
  }

  if (hasOwnField(payload, "email")) {
    patch.email = validateRequiredEmail(payload.email, details);
  }

  if (hasOwnField(payload, "phone_number")) {
    patch.phone_number = validateOptionalPhoneNumber(
      payload.phone_number,
      details,
    );
  }

  if (hasOwnField(payload, "address")) {
    patch.address = validateOptionalTrimmedNonEmpty(
      payload.address,
      "address",
      details,
      ADDRESS_MAX_LENGTH,
    );
  }

  if (hasOwnField(payload, "unit_building")) {
    patch.unit_building = validateOptionalTrimmedNonEmpty(
      payload.unit_building,
      "unit_building",
      details,
      UNIT_MAX_LENGTH,
    );
  }

  if (hasOwnField(payload, "active")) {
    patch.active = validateBoolean(payload.active, "active", details, true);
  }

  if (hasOwnField(payload, "deactivated_at")) {
    if (payload.deactivated_at !== null) {
      details.push({
        field: "deactivated_at",
        message:
          'Only null is supported (reactivate). Use "active": false to deactivate.',
      });
    } else if (patch.active === false) {
      details.push({
        field: "deactivated_at",
        message:
          '"deactivated_at": null cannot be combined with "active": false.',
      });
    } else {
      patch.active = true;
    }
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field: "form", message: "No valid fields to update." },
    ]);
  }

  return patch;
}

function mergeProviderUpdate(
  existing: ProviderApiRecord,
  patch: UpdateProviderInput,
): CreateProviderInput {
  return {
    abn: patch.abn !== undefined ? patch.abn : existing.abn,
    name: patch.name !== undefined ? patch.name : existing.name.trim(),
    email: patch.email !== undefined ? patch.email : existing.email,
    phone_number:
      patch.phone_number !== undefined
        ? patch.phone_number
        : existing.phone_number,
    address: patch.address !== undefined ? patch.address : existing.address,
    unit_building:
      patch.unit_building !== undefined
        ? patch.unit_building
        : existing.unit_building,
    active:
      patch.active !== undefined
        ? patch.active
        : existing.deactivated_at === null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnField(
  payload: Record<string, unknown>,
  field: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(payload, field);
}

function validateBoolean(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
  required: boolean,
): boolean {
  if (value === undefined || value === null) {
    if (required) {
      details.push({ field, message: "This field is required." });
    }

    return true;
  }

  if (typeof value !== "boolean") {
    details.push({ field, message: "Must be a boolean." });
    return true;
  }

  return value;
}

function validateRequiredString(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) {
    details.push({ field, message: "This field is required." });
    return undefined;
  }

  if (typeof value !== "string") {
    details.push({ field, message: "Must be a string." });
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    details.push({ field, message: "This field is required." });
    return undefined;
  }

  if (trimmed.length > maxLength) {
    details.push({
      field,
      message: `Must be ${maxLength} characters or fewer.`,
    });
    return undefined;
  }

  return trimmed;
}

function validateOptionalString(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    details.push({ field, message: "Must be a string or null." });
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  if (trimmed.length > maxLength) {
    details.push({
      field,
      message: `Must be ${maxLength} characters or fewer.`,
    });
    return null;
  }

  return trimmed;
}

const EMAIL_SHAPE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** SEC: Required ABN — digits only, up to ABN_DIGITS. */
function validateRequiredAbn(
  value: unknown,
  details: ApiErrorDetail[],
): string | undefined {
  if (value === undefined || value === null) {
    details.push({ field: "abn", message: "This field is required." });
    return undefined;
  }

  if (typeof value !== "string") {
    details.push({ field: "abn", message: "Must be a string." });
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    details.push({ field: "abn", message: "This field is required." });
    return undefined;
  }

  if (!/^\d+$/.test(trimmed) || trimmed.length > ABN_DIGITS) {
    details.push({ field: "abn", message: MSG_ABN_INVALID });
    return undefined;
  }

  return trimmed;
}

/** SEC: Optional phone — digits only, 3–16 digits when provided. */
function validateOptionalPhoneNumber(
  value: unknown,
  details: ApiErrorDetail[],
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    details.push({
      field: "phone_number",
      message: "Must be a string or null.",
    });
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    details.push({
      field: "phone_number",
      message: "Phone number must contain digits only.",
    });
    return null;
  }

  if (
    trimmed.length < PHONE_MIN_DIGITS ||
    trimmed.length > PHONE_MAX_DIGITS
  ) {
    details.push({ field: "phone_number", message: MSG_PHONE_INVALID });
    return null;
  }

  return trimmed;
}

/** SEC: Optional text — null/omit OK; if sent, must be non-empty after trim. */
function validateOptionalTrimmedNonEmpty(
  value: unknown,
  field: "address" | "unit_building",
  details: ApiErrorDetail[],
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    details.push({ field, message: "Must be a string or null." });
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    details.push({ field, message: MSG_OPTIONAL_NON_EMPTY });
    return null;
  }

  if (trimmed.length > maxLength) {
    details.push({
      field,
      message: `Must be ${maxLength} characters or fewer.`,
    });
    return null;
  }

  return trimmed;
}

function validateRequiredEmail(
  value: unknown,
  details: ApiErrorDetail[],
): string | undefined {
  if (value === undefined || value === null) {
    details.push({ field: "email", message: "This field is required." });
    return undefined;
  }

  if (typeof value !== "string") {
    details.push({ field: "email", message: "Must be a string." });
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();

  if (trimmed === "") {
    details.push({ field: "email", message: "This field is required." });
    return undefined;
  }

  if (trimmed.length > EMAIL_MAX_LENGTH) {
    details.push({
      field: "email",
      message: `Must be ${EMAIL_MAX_LENGTH} characters or fewer.`,
    });
    return undefined;
  }

  if (!EMAIL_SHAPE_PATTERN.test(trimmed)) {
    details.push({ field: "email", message: MSG_EMAIL_INVALID });
    return undefined;
  }

  return trimmed;
}

function translateRepositoryError(
  error: unknown,
  _action: "read" | "create" | "update" | "delete",
): ApiError | Error {
  const code = getDatabaseErrorCode(error);

  if (code === "42P01") {
    return new ApiError(
      503,
      "PROVIDER_TABLE_UNAVAILABLE",
      "Provider table is not available.",
    );
  }

  if (code === "42703") {
    return new ApiError(
      503,
      "PROVIDER_SCHEMA_MISMATCH",
      "Provider table schema does not match this API. Ensure DDL has run or unset RBAC_SKIP_DDL.",
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown repository error.");
}

function getDatabaseErrorCode(error: unknown): string | undefined {
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
