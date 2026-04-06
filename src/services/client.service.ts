import { ApiError, type ApiErrorDetail } from "@/lib/api/errors";
import {
  activeGenderExists,
  activePricingRegionExists,
  getClientRowById,
  insertClientRow,
  listClientRows,
  softDeleteClientRow,
  updateClientRow,
} from "@/repositories/client.repository";
import {
  mapClientRow,
  mapClientRowToCreateClientInput,
  type Client,
  type CreateClientInput,
  type UpdateClientInput,
} from "@/modules/client/types";
import { recordAuditEvent } from "@/services/audit-log.service";

const ALLOWED_FIELDS = new Set([
  "address",
  "active",
  "deactivated_at",
  "dob",
  "email",
  "firstName",
  "first_name",
  "genderId",
  "gender_id",
  "lastName",
  "last_name",
  "ndisNumber",
  "ndis_number",
  "phoneNumber",
  "phone_number",
  "pricingRegion",
  "pricing_region",
  "unitBuilding",
  "unit_building",
]);

const ADDRESS_MAX_LENGTH = 500;
const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 100;
const NDIS_NUMBER_MAX_LENGTH = 16;
const PHONE_MAX_LENGTH = 16;
const PHONE_MIN_LENGTH = 3;
const PRICING_REGION_MAX_LENGTH = 32;
const UNIT_BUILDING_MAX_LENGTH = 100;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function listClients(): Promise<Client[]> {
  try {
    const rows = await listClientRows();

    return rows.map(mapClientRow);
  } catch (error) {
    throw translateRepositoryError(error, "read");
  }
}

export async function createClient(payload: unknown): Promise<Client> {
  const input = validateCreateClientPayload(payload);
  await assertClientReferences(input);

  try {
    const row = await insertClientRow(input);
    const client = mapClientRow(row);

    await recordAuditEvent({
      action: "client.create",
      entity: "client",
      entityId: client.id,
      permission: "clients.write",
    });

    return client;
  } catch (error) {
    throw translateRepositoryError(error, "create");
  }
}

export async function getClient(clientIdValue: string): Promise<Client> {
  const clientId = parseClientId(clientIdValue);

  try {
    const row = await getClientRowById(clientId);

    if (!row) {
      throw createClientNotFoundError();
    }

    return mapClientRow(row);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "read");
  }
}

export async function updateClient(
  clientIdValue: string,
  payload: unknown,
): Promise<Client> {
  const clientId = parseClientId(clientIdValue);
  const patch = validateUpdateClientPayload(payload);

  try {
    const existingRow = await getClientRowById(clientId);

    if (!existingRow) {
      throw createClientNotFoundError();
    }

    const input: CreateClientInput = {
      ...mapClientRowToCreateClientInput(existingRow),
      ...patch,
    };

    await assertClientReferences(input);

    const row = await updateClientRow(clientId, input);

    if (!row) {
      throw createClientNotFoundError();
    }

    const client = mapClientRow(row);

    await recordAuditEvent({
      action: "client.update",
      entity: "client",
      entityId: client.id,
      permission: "clients.write",
      before: mapClientRow(existingRow),
      after: client,
    });

    return client;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "update");
  }
}

export async function deleteClient(
  clientIdValue: string,
): Promise<{ id: string; deletedAt: string }> {
  const clientId = parseClientId(clientIdValue);

  try {
    const existingRow = await getClientRowById(clientId);

    if (!existingRow) {
      throw createClientNotFoundError();
    }

    const deletedClient = await softDeleteClientRow(clientId);

    if (!deletedClient) {
      throw createClientNotFoundError();
    }

    await recordAuditEvent({
      action: "client.delete",
      entity: "client",
      entityId: deletedClient.id,
      permission: "clients.delete",
      before: mapClientRow(existingRow),
    });

    return {
      id: deletedClient.id,
      deletedAt: deletedClient.deleted_at,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw translateRepositoryError(error, "delete");
  }
}

function validateCreateClientPayload(payload: unknown): CreateClientInput {
  if (!isPlainObject(payload)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
    );
  }

  const details: ApiErrorDetail[] = [];

  // SEC: Reject unknown fields to keep the API contract explicit and predictable.
  for (const fieldName of Object.keys(payload)) {
    if (!ALLOWED_FIELDS.has(fieldName)) {
      details.push({
        field: fieldName,
        message: "Unsupported field.",
      });
    }
  }

  const firstName = validateRequiredText(
    readPayloadField(payload, "firstName", "first_name"),
    "firstName",
    NAME_MAX_LENGTH,
    details,
  );
  const lastName = validateRequiredText(
    readPayloadField(payload, "lastName", "last_name"),
    "lastName",
    NAME_MAX_LENGTH,
    details,
  );
  const genderId = validateRequiredInteger(
    readPayloadField(payload, "genderId", "gender_id"),
    "genderId",
    details,
  );
  const dob = validateRequiredDate(readPayloadField(payload, "dob"), "dob", details);
  const ndisNumber = validateRequiredNdisNumber(
    readPayloadField(payload, "ndisNumber", "ndis_number"),
    details,
  );
  const email = validateRequiredEmail(readPayloadField(payload, "email"), details);
  const phoneNumber = validatePhoneNumber(
    readPayloadField(payload, "phoneNumber", "phone_number"),
    details,
  );
  const address = validateRequiredText(
    readPayloadField(payload, "address"),
    "address",
    ADDRESS_MAX_LENGTH,
    details,
  );
  const unitBuilding = validateOptionalTrimmedText(
    readPayloadField(payload, "unitBuilding", "unit_building"),
    "unitBuilding",
    UNIT_BUILDING_MAX_LENGTH,
    details,
  );
  const pricingRegion = validateRequiredText(
    readPayloadField(payload, "pricingRegion", "pricing_region"),
    "pricingRegion",
    PRICING_REGION_MAX_LENGTH,
    details,
  );
  const active = resolveClientActive(payload, details, true);

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  return {
    firstName,
    lastName,
    genderId,
    dob,
    ndisNumber,
    email,
    phoneNumber,
    address,
    unitBuilding,
    pricingRegion,
    active,
  };
}

function validateUpdateClientPayload(payload: unknown): UpdateClientInput {
  if (!isPlainObject(payload)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
    );
  }

  const details: ApiErrorDetail[] = [];
  const patch: UpdateClientInput = {};

  // SEC: Reject unknown fields so partial updates cannot silently change API shape.
  for (const fieldName of Object.keys(payload)) {
    if (!ALLOWED_FIELDS.has(fieldName)) {
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

  if (hasAnyPayloadField(payload, "firstName", "first_name")) {
    patch.firstName = validateRequiredText(
      readPayloadField(payload, "firstName", "first_name"),
      "firstName",
      NAME_MAX_LENGTH,
      details,
    );
  }

  if (hasAnyPayloadField(payload, "lastName", "last_name")) {
    patch.lastName = validateRequiredText(
      readPayloadField(payload, "lastName", "last_name"),
      "lastName",
      NAME_MAX_LENGTH,
      details,
    );
  }

  if (hasAnyPayloadField(payload, "genderId", "gender_id")) {
    patch.genderId = validateRequiredInteger(
      readPayloadField(payload, "genderId", "gender_id"),
      "genderId",
      details,
    );
  }

  if (hasAnyPayloadField(payload, "dob")) {
    patch.dob = validateRequiredDate(readPayloadField(payload, "dob"), "dob", details);
  }

  if (hasAnyPayloadField(payload, "ndisNumber", "ndis_number")) {
    patch.ndisNumber = validateRequiredNdisNumber(
      readPayloadField(payload, "ndisNumber", "ndis_number"),
      details,
    );
  }

  if (hasAnyPayloadField(payload, "email")) {
    patch.email = validateRequiredEmail(readPayloadField(payload, "email"), details);
  }

  if (hasAnyPayloadField(payload, "phoneNumber", "phone_number")) {
    patch.phoneNumber = validatePhoneNumber(
      readPayloadField(payload, "phoneNumber", "phone_number"),
      details,
    );
  }

  if (hasAnyPayloadField(payload, "address")) {
    patch.address = validateRequiredText(
      readPayloadField(payload, "address"),
      "address",
      ADDRESS_MAX_LENGTH,
      details,
    );
  }

  if (hasAnyPayloadField(payload, "unitBuilding", "unit_building")) {
    patch.unitBuilding = validateOptionalTrimmedText(
      readPayloadField(payload, "unitBuilding", "unit_building"),
      "unitBuilding",
      UNIT_BUILDING_MAX_LENGTH,
      details,
    );
  }

  if (hasAnyPayloadField(payload, "pricingRegion", "pricing_region")) {
    patch.pricingRegion = validateRequiredText(
      readPayloadField(payload, "pricingRegion", "pricing_region"),
      "pricingRegion",
      PRICING_REGION_MAX_LENGTH,
      details,
    );
  }

  if (hasAnyPayloadField(payload, "active", "deactivated_at")) {
    patch.active = resolveClientActive(payload, details, true);
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

function hasAnyPayloadField(
  value: Record<string, unknown>,
  ...fields: string[]
): boolean {
  return fields.some((field) => hasOwnField(value, field));
}

function readPayloadField(
  value: Record<string, unknown>,
  ...fields: string[]
): unknown {
  for (const field of fields) {
    if (hasOwnField(value, field)) {
      return value[field];
    }
  }

  return undefined;
}

function resolveClientActive(
  payload: Record<string, unknown>,
  details: ApiErrorDetail[],
  defaultValue: boolean,
): boolean {
  if (hasOwnField(payload, "active")) {
    return validateBoolean(payload.active, "active", details);
  }

  if (!hasOwnField(payload, "deactivated_at")) {
    return defaultValue;
  }

  const value = payload.deactivated_at;

  if (value === null || value === "") {
    return true;
  }

  if (typeof value === "string") {
    return false;
  }

  details.push({
    field: "deactivated_at",
    message: "Must be null or a datetime string.",
  });

  return defaultValue;
}

function validateRequiredText(
  value: unknown,
  field: string,
  maxLength: number,
  details: ApiErrorDetail[],
): string {
  if (typeof value !== "string") {
    details.push({
      field,
      message: "Must be a string.",
    });

    return "";
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    details.push({
      field,
      message: "This field is required.",
    });

    return "";
  }

  if (normalizedValue.length > maxLength) {
    details.push({
      field,
      message: `Must be ${maxLength} characters or fewer.`,
    });
  }

  return normalizedValue;
}

function validateRequiredInteger(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
): number {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  ) {
    details.push({
      field,
      message: "This field is required.",
    });

    return 0;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    details.push({
      field,
      message: "Must be a positive integer.",
    });

    return 0;
  }

  return value;
}

function validateBoolean(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
): boolean {
  if (typeof value !== "boolean") {
    details.push({
      field,
      message: "Must be a boolean.",
    });

    return false;
  }

  return value;
}

function validateRequiredDate(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
): string {
  if (typeof value !== "string") {
    details.push({
      field,
      message: "Must be a date string in YYYY-MM-DD format.",
    });

    return "";
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    details.push({
      field,
      message: "This field is required.",
    });

    return "";
  }

  if (!DATE_ONLY_PATTERN.test(normalizedValue)) {
    details.push({
      field,
      message: "Must be a date in YYYY-MM-DD format.",
    });

    return normalizedValue;
  }

  const parsedDate = new Date(`${normalizedValue}T00:00:00.000Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== normalizedValue
  ) {
    details.push({
      field,
      message: "Must be a valid calendar date.",
    });

    return normalizedValue;
  }

  const today = new Date().toISOString().slice(0, 10);

  if (normalizedValue > today) {
    details.push({
      field,
      message: "Cannot be in the future.",
    });
  }

  return normalizedValue;
}

function validateOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
  details: ApiErrorDetail[],
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    details.push({
      field,
      message: "Must be a string.",
    });

    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.length > maxLength) {
    details.push({
      field,
      message: `Must be ${maxLength} characters or fewer.`,
    });
  }

  return normalizedValue;
}

function validateOptionalTrimmedText(
  value: unknown,
  field: string,
  maxLength: number,
  details: ApiErrorDetail[],
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    details.push({
      field,
      message: "Must be a string.",
    });

    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    details.push({
      field,
      message: "Cannot be empty when provided.",
    });

    return null;
  }

  if (normalizedValue.length > maxLength) {
    details.push({
      field,
      message: `Must be ${maxLength} characters or fewer.`,
    });
  }

  return normalizedValue;
}

function validateRequiredEmail(
  value: unknown,
  details: ApiErrorDetail[],
): string {
  const email = validateRequiredText(value, "email", EMAIL_MAX_LENGTH, details);

  if (!email) {
    return "";
  }

  const normalizedEmail = email.toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    details.push({
      field: "email",
      message: "Must be a valid email address.",
    });
  }

  return normalizedEmail;
}

function validatePhoneNumber(
  value: unknown,
  details: ApiErrorDetail[],
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    details.push({
      field: "phoneNumber",
      message: "Must be a string.",
    });

    return null;
  }

  const phone = value.trim();

  if (!phone) {
    details.push({
      field: "phoneNumber",
      message: "Cannot be empty when provided.",
    });

    return null;
  }

  if (!/^\d+$/.test(phone)) {
    details.push({
      field: "phoneNumber",
      message: "Must contain digits only.",
    });
  }

  if (phone.length < PHONE_MIN_LENGTH || phone.length > PHONE_MAX_LENGTH) {
    details.push({
      field: "phoneNumber",
      message: `Must contain between ${PHONE_MIN_LENGTH} and ${PHONE_MAX_LENGTH} digits.`,
    });
  }

  return phone;
}

function validateRequiredNdisNumber(
  value: unknown,
  details: ApiErrorDetail[],
): string {
  if (typeof value !== "string") {
    details.push({
      field: "ndisNumber",
      message:
        value === undefined || value === null
          ? "This field is required."
          : "Must be a string.",
    });

    return "";
  }

  const ndisNumber = value.trim();

  if (!ndisNumber) {
    details.push({
      field: "ndisNumber",
      message: "This field is required.",
    });

    return "";
  }

  if (!/^\d+$/.test(ndisNumber)) {
    details.push({
      field: "ndisNumber",
      message: "Must contain digits only.",
    });
  }

  if (ndisNumber.length > NDIS_NUMBER_MAX_LENGTH) {
    details.push({
      field: "ndisNumber",
      message: `Must be ${NDIS_NUMBER_MAX_LENGTH} digits or fewer.`,
    });
  }

  return ndisNumber;
}

function parseClientId(clientIdValue: string): number {
  const clientId = Number(clientIdValue);

  if (!Number.isInteger(clientId) || clientId < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "id",
        message: "Client id must be a positive integer.",
      },
    ]);
  }

  return clientId;
}

function createClientNotFoundError(): ApiError {
  return new ApiError(404, "CLIENT_NOT_FOUND", "Client not found.");
}

async function assertClientReferences(
  input: CreateClientInput,
): Promise<void> {
  const [genderExists, pricingRegionExists] = await Promise.all([
    activeGenderExists(input.genderId),
    activePricingRegionExists(input.pricingRegion),
  ]);

  const details: ApiErrorDetail[] = [];

  if (!genderExists) {
    details.push({
      field: "genderId",
      message: "Select a valid active gender.",
    });
  }

  if (!pricingRegionExists) {
    details.push({
      field: "pricingRegion",
      message: "Select a valid active pricing region.",
    });
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }
}

function translateRepositoryError(
  error: unknown,
  action: "read" | "create" | "update" | "delete",
): ApiError | Error {
  const code = getDatabaseErrorCode(error);
  const constraint = getDatabaseConstraintName(error);

  if (code === "42P01") {
    return new ApiError(
      503,
      "CLIENT_TABLE_UNAVAILABLE",
      "Client table is not available.",
    );
  }

  if ((action === "create" || action === "update") && code === "23503") {
    if (constraint === "client_gender_id_fkey") {
      return new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "genderId",
          message: "Select a valid active gender.",
        },
      ]);
    }

    if (constraint === "client_pricing_region_fkey") {
      return new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "pricingRegion",
          message: "Select a valid active pricing region.",
        },
      ]);
    }
  }

  if ((action === "create" || action === "update") && code === "23505") {
    if (constraint === "client_unique_ndis_number") {
      return new ApiError(
        409,
        "CLIENT_NDIS_NUMBER_CONFLICT",
        "A client with this NDIS number already exists.",
        [
          {
            field: "ndisNumber",
            message: "This NDIS number is already in use.",
          },
        ],
      );
    }

    return new ApiError(
      409,
      "CLIENT_ALREADY_EXISTS",
      "A client with those details already exists.",
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
