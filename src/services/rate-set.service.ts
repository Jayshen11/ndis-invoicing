import { ApiError } from "@/lib/api/errors";
import { db } from "@/db/client";
import type {
  RateSetApiRow,
  RateSetDateGapCheckResponse,
  RateSetDateOverlapCheckResponse,
  RateSetImportGridData,
  RateSetImportedState,
  RateSetListFilters,
} from "@/modules/rate-set/types";
import {
  countRateSetRows,
  getNextAdjacentRateSetWindowRow,
  getPreviousAdjacentRateSetWindowRow,
  getRateSetRowById,
  insertRateSetRow,
  insertRateSetRowWithExecutor,
  listRateSetRows,
  listOverlappingRateSetWindowRows,
  softDeleteRateSetRow,
  updateRateSetRow,
  updateRateSetRowWithExecutor,
  type RateSetDbRow,
  type RateSetDateWindowRow,
} from "@/repositories/rate-set.repository";
import {
  ensureRateSetInvoiceSchema,
  getRateSetImportGridRows,
  hasImportedRatesForRateSet,
  RATE_SET_IMPORT_GRID_COLUMNS,
} from "@/repositories/rate-set-invoice.repository";
import {
  applyParsedNdisExcelImport,
  type NdisExcelImportResult,
  validateAndParseNdisExcelBuffer,
} from "@/services/ndis-excel-import.service";
import { recordAuditEvent } from "@/services/audit-log.service";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 500;
const SEARCH_MAX = 200;
const NAME_MAX = 300;
const DESCRIPTION_MAX = 8000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type RateSetListPage = {
  data: RateSetApiRow[];
  pagination: { limit: number; offset: number; total: number };
};

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

function parseOptionalYmd(
  raw: string | null,
  field: string,
): string | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }

  const trimmed = raw.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field,
        message: "Must be a date in YYYY-MM-DD format.",
      },
    ]);
  }

  return trimmed;
}

function parseFlexibleDateParam(
  raw: string | null,
  field: string,
  required: boolean,
): string | null {
  const trimmed = raw?.trim() ?? "";

  if (trimmed === "") {
    if (!required) {
      return null;
    }

    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field,
        message: "This field is required.",
      },
    ]);
  }

  const ymdMatch = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(trimmed);

  if (!ymdMatch) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field,
        message: "Must be a valid ISO date or YYYY-MM-DD value.",
      },
    ]);
  }

  return ymdMatch[1] ?? null;
}

function parseOptionalPositiveIntParam(
  raw: string | null,
  field: string,
): number | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field,
        message: "Must be a positive integer.",
      },
    ]);
  }

  return parsed;
}

function parseRateSetWindowCheckInput(searchParams: URLSearchParams): {
  startDateYmd: string;
  endDateYmd: string | null;
  excludeId: number | null;
} {
  const startDateYmdValue = parseFlexibleDateParam(
    searchParams.get("start_date"),
    "start_date",
    true,
  );
  const startDateYmd = startDateYmdValue ?? "";
  const endDateYmd = parseFlexibleDateParam(
    searchParams.get("end_date"),
    "end_date",
    false,
  );
  const excludeId = parseOptionalPositiveIntParam(
    searchParams.get("exclude_id"),
    "exclude_id",
  );

  if (endDateYmd !== null && endDateYmd < startDateYmd) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "end_date",
        message: "Must be on or after start_date.",
      },
    ]);
  }

  return {
    startDateYmd,
    endDateYmd,
    excludeId,
  };
}

function parseActiveFilter(
  raw: string | null,
): boolean | null {
  if (raw === null || raw.trim() === "" || raw === "all") {
    return null;
  }

  if (raw === "active") {
    return true;
  }

  if (raw === "inactive") {
    return false;
  }

  throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
    {
      field: "active",
      message: 'Must be "all", "active", or "inactive".',
    },
  ]);
}

function mapDbRowToApi(row: RateSetDbRow): RateSetApiRow {
  const startYmd = row.start_date.slice(0, 10);
  const endYmd = row.end_date?.slice(0, 10) ?? null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    start_date: `${startYmd}T00:00:00.000Z`,
    end_date: endYmd === null ? null : `${endYmd}T00:00:00.000Z`,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    deactivated_at: row.deactivated_at?.toISOString() ?? null,
    deleted_at: row.deleted_at?.toISOString() ?? null,
  };
}

function formatYmdForLabel(ymd: string | null): string {
  if (ymd === null || ymd === "") {
    return "No End Date";
  }

  const [year, month, day] = ymd.split("-");

  if (!year || !month || !day) {
    return ymd;
  }

  return `${day}/${month}/${year}`;
}

function formatRateSetWindowLabel(row: RateSetDateWindowRow): string {
  return `${row.name} (${formatYmdForLabel(row.start_date)} - ${formatYmdForLabel(row.end_date)})`;
}

function addDaysToYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function assertNoRateSetDateOverlap(params: {
  startDateYmd: string;
  endDateYmd: string | null;
  excludeId?: number;
}): Promise<void> {
  const overlaps = await listOverlappingRateSetWindowRows({
    startDateYmd: params.startDateYmd,
    endDateYmd: params.endDateYmd,
    excludeId: params.excludeId ?? null,
  });

  if (overlaps.length === 0) {
    return;
  }

  throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
    {
      field: "form",
      message: `Rate set dates overlap an existing period: ${overlaps
        .map(formatRateSetWindowLabel)
        .join(", ")}.`,
    },
  ]);
}

function parseRateSetId(rateSetIdValue: string): number {
  const parsed = Number.parseInt(rateSetIdValue, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "id",
        message: "Rate set id must be a positive integer.",
      },
    ]);
  }

  return parsed;
}

function parseRateSetListFilters(searchParams: URLSearchParams): RateSetListFilters {
  const rawSearch = searchParams.get("search")?.trim() ?? "";

  if (rawSearch.length > SEARCH_MAX) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "search",
        message: `Must be ${SEARCH_MAX} characters or fewer.`,
      },
    ]);
  }

  const periodStart = parseOptionalYmd(
    searchParams.get("period_start"),
    "period_start",
  );
  const periodEnd = parseOptionalYmd(
    searchParams.get("period_end"),
    "period_end",
  );

  if (
    (periodStart === null && periodEnd !== null) ||
    (periodStart !== null && periodEnd === null)
  ) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "period_start",
        message: "Provide both period_start and period_end, or omit both.",
      },
    ]);
  }

  if (periodStart !== null && periodEnd !== null && periodStart > periodEnd) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "period_end",
        message: "Must be on or after period_start.",
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
    periodStart,
    periodEnd,
    activeOnly: parseActiveFilter(searchParams.get("active")),
    limit,
    offset,
  };
}

export async function listRateSetsPage(
  searchParams: URLSearchParams,
): Promise<RateSetListPage> {
  const filters = parseRateSetListFilters(searchParams);
  const [total, rows] = await Promise.all([
    countRateSetRows(filters),
    listRateSetRows(filters),
  ]);

  return {
    data: rows.map(mapDbRowToApi),
    pagination: {
      limit: filters.limit,
      offset: filters.offset,
      total,
    },
  };
}

function parseRequiredYmd(
  value: unknown,
  field: string,
  details: { field: string; message: string }[],
): string | null {
  if (value === undefined || value === null || value === "") {
    details.push({ field, message: "This field is required." });
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    details.push({
      field,
      message: "Must be a date in YYYY-MM-DD format.",
    });
    return null;
  }

  return value.trim();
}

function parseOptionalYmdBody(
  value: unknown,
  field: string,
  details: { field: string; message: string }[],
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    details.push({
      field,
      message: "Must be a date in YYYY-MM-DD format.",
    });
    return null;
  }

  return value.trim();
}

function parseActiveBoolean(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  return Boolean(value);
}

type ValidatedRateSetMutationInput = {
  name: string;
  description: string | null;
  startDateYmd: string;
  endDateYmd: string | null;
  active: boolean;
};

function validateRateSetMutationPayload(
  payload: unknown,
): ValidatedRateSetMutationInput {
  if (!isPlainObject(payload)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
      [],
    );
  }

  const details: { field: string; message: string }[] = [];
  const rawName = payload.name;
  let name = "";

  if (typeof rawName !== "string") {
    details.push({ field: "name", message: "Must be a string." });
  } else {
    name = rawName.trim();

    if (name === "") {
      details.push({ field: "name", message: "This field is required." });
    } else if (name.length > NAME_MAX) {
      details.push({
        field: "name",
        message: `Must be ${NAME_MAX} characters or fewer.`,
      });
    }
  }

  let description: string | null = null;

  if (payload.description !== undefined && payload.description !== null) {
    if (typeof payload.description !== "string") {
      details.push({
        field: "description",
        message: "Must be a string.",
      });
    } else {
      const trimmed = payload.description.trim();

      if (trimmed.length > DESCRIPTION_MAX) {
        details.push({
          field: "description",
          message: `Must be ${DESCRIPTION_MAX} characters or fewer.`,
        });
      } else {
        description = trimmed === "" ? null : trimmed;
      }
    }
  }

  const startDateYmd = parseRequiredYmd(payload.start_date, "start_date", details);
  const endDateYmd = parseOptionalYmdBody(
    payload.end_date,
    "end_date",
    details,
  );

  if (
    startDateYmd !== null &&
    endDateYmd !== null &&
    endDateYmd < startDateYmd
  ) {
    details.push({
      field: "end_date",
      message: "Must be on or after start date.",
    });
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  if (startDateYmd === null) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field: "start_date", message: "This field is required." },
    ]);
  }

  return {
    name,
    description,
    startDateYmd,
    endDateYmd,
    active: parseActiveBoolean(payload.active),
  };
}

export async function createRateSet(payload: unknown): Promise<RateSetApiRow> {
  const input = validateRateSetMutationPayload(payload);
  await assertNoRateSetDateOverlap({
    startDateYmd: input.startDateYmd,
    endDateYmd: input.endDateYmd,
  });
  const row = await insertRateSetRow(input);
  const rateSet = mapDbRowToApi(row);

  await recordAuditEvent({
    action: "rate_set.create",
    entity: "rate_set",
    entityId: rateSet.id,
    permission: "rate_sets.write",
  });

  return rateSet;
}

export async function createRateSetWithExcel(
  payload: unknown,
  buffer: Buffer,
): Promise<{ rateSet: RateSetApiRow; importResult: NdisExcelImportResult }> {
  const input = validateRateSetMutationPayload(payload);
  const parsedImport = validateAndParseNdisExcelBuffer(buffer);
  await assertNoRateSetDateOverlap({
    startDateYmd: input.startDateYmd,
    endDateYmd: input.endDateYmd,
  });

  await ensureRateSetInvoiceSchema();

  return db.transaction().execute(async (trx) => {
    const row = await insertRateSetRowWithExecutor(trx, input);
    const importResult = await applyParsedNdisExcelImport(trx, row.id, parsedImport);
    const rateSet = mapDbRowToApi(row);

    await recordAuditEvent({
      action: "rate_set.create",
      entity: "rate_set",
      entityId: rateSet.id,
      permission: "rate_sets.write",
    });

    await recordAuditEvent({
      action: "rate_set.import",
      entity: "rate_set",
      entityId: rateSet.id,
      permission: "rate_sets.import",
      after: {
        categories_touched: importResult.stats.categoriesTouched,
        items_touched: importResult.stats.itemsTouched,
        price_rows_written: importResult.stats.priceRowsWritten,
      },
    });

    return {
      rateSet,
      importResult,
    };
  });
}

export async function getRateSet(rateSetIdValue: string): Promise<RateSetApiRow> {
  const rateSetId = parseRateSetId(rateSetIdValue);
  const row = await getRateSetRowById(rateSetId);

  if (!row) {
    throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
  }

  return mapDbRowToApi(row);
}

export async function checkRateSetDateOverlap(
  searchParams: URLSearchParams,
): Promise<RateSetDateOverlapCheckResponse> {
  const { startDateYmd, endDateYmd, excludeId } =
    parseRateSetWindowCheckInput(searchParams);
  const overlaps = await listOverlappingRateSetWindowRows({
    startDateYmd,
    endDateYmd,
    excludeId,
  });

  return {
    exists: overlaps.length > 0,
    overlaps: overlaps.map(formatRateSetWindowLabel),
  };
}

export async function checkRateSetDateGap(
  searchParams: URLSearchParams,
): Promise<RateSetDateGapCheckResponse> {
  const { startDateYmd, endDateYmd, excludeId } =
    parseRateSetWindowCheckInput(searchParams);

  const [previous, next] = await Promise.all([
    getPreviousAdjacentRateSetWindowRow({
      startDateYmd,
      excludeId,
    }),
    endDateYmd === null
      ? Promise.resolve(undefined)
      : getNextAdjacentRateSetWindowRow({
          endDateYmd,
          excludeId,
        }),
  ]);

  const adjacent: string[] = [];
  let hasGap = false;

  if (previous?.end_date) {
    const previousDayAfterEnd = addDaysToYmd(previous.end_date, 1);

    if (previousDayAfterEnd < startDateYmd) {
      hasGap = true;
      adjacent.push(formatRateSetWindowLabel(previous));
    }
  }

  if (next && endDateYmd !== null) {
    const nextDayAfterCurrent = addDaysToYmd(endDateYmd, 1);

    if (nextDayAfterCurrent < next.start_date) {
      hasGap = true;
      adjacent.push(formatRateSetWindowLabel(next));
    }
  }

  return {
    hasGap,
    adjacent,
  };
}

export async function updateRateSet(
  rateSetIdValue: string,
  payload: unknown,
): Promise<RateSetApiRow> {
  const rateSetId = parseRateSetId(rateSetIdValue);
  const existingRow = await getRateSetRowById(rateSetId);

  if (!existingRow) {
    throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
  }

  const input = validateRateSetMutationPayload(payload);
  await assertNoRateSetDateOverlap({
    startDateYmd: input.startDateYmd,
    endDateYmd: input.endDateYmd,
    excludeId: rateSetId,
  });
  const row = await updateRateSetRow({
    id: rateSetId,
    ...input,
  });

  if (!row) {
    throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
  }

  const rateSet = mapDbRowToApi(row);

  await recordAuditEvent({
    action: "rate_set.update",
    entity: "rate_set",
    entityId: rateSet.id,
    permission: "rate_sets.write",
    before: mapDbRowToApi(existingRow),
    after: rateSet,
  });

  return rateSet;
}

export async function updateRateSetWithExcel(
  rateSetIdValue: string,
  payload: unknown,
  buffer: Buffer,
): Promise<{ rateSet: RateSetApiRow; importResult: NdisExcelImportResult }> {
  const rateSetId = parseRateSetId(rateSetIdValue);
  const existingRow = await getRateSetRowById(rateSetId);

  if (!existingRow) {
    throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
  }

  const input = validateRateSetMutationPayload(payload);
  const parsedImport = validateAndParseNdisExcelBuffer(buffer);
  await assertNoRateSetDateOverlap({
    startDateYmd: input.startDateYmd,
    endDateYmd: input.endDateYmd,
    excludeId: rateSetId,
  });

  await ensureRateSetInvoiceSchema();

  return db.transaction().execute(async (trx) => {
    const row = await updateRateSetRowWithExecutor(trx, {
      id: rateSetId,
      ...input,
    });

    if (!row) {
      throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
    }

    const importResult = await applyParsedNdisExcelImport(trx, rateSetId, parsedImport);
    const rateSet = mapDbRowToApi(row);

    await recordAuditEvent({
      action: "rate_set.update",
      entity: "rate_set",
      entityId: rateSet.id,
      permission: "rate_sets.write",
      before: mapDbRowToApi(existingRow),
      after: rateSet,
    });

    await recordAuditEvent({
      action: "rate_set.import",
      entity: "rate_set",
      entityId: rateSet.id,
      permission: "rate_sets.import",
      after: {
        categories_touched: importResult.stats.categoriesTouched,
        items_touched: importResult.stats.itemsTouched,
        price_rows_written: importResult.stats.priceRowsWritten,
      },
    });

    return {
      rateSet,
      importResult,
    };
  });
}

export async function getRateSetImportedState(
  rateSetIdValue: string,
): Promise<RateSetImportedState> {
  const rateSetId = parseRateSetId(rateSetIdValue);
  const row = await getRateSetRowById(rateSetId);

  if (!row) {
    throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
  }

  return {
    hasImportedRates: await hasImportedRatesForRateSet(rateSetId),
  };
}

export async function getRateSetImportGrid(
  rateSetIdValue: string,
): Promise<RateSetImportGridData> {
  const rateSetId = parseRateSetId(rateSetIdValue);
  const row = await getRateSetRowById(rateSetId);

  if (!row) {
    throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
  }

  return {
    columns: RATE_SET_IMPORT_GRID_COLUMNS,
    rows: await getRateSetImportGridRows(rateSetId),
  };
}

export async function deleteRateSet(
  rateSetIdValue: string,
): Promise<{ id: number; deleted_at: string }> {
  const parsed = parseRateSetId(rateSetIdValue);
  const existingRow = await getRateSetRowById(parsed);

  if (!existingRow) {
    throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
  }

  const result = await softDeleteRateSetRow(parsed);

  if (!result) {
    throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
  }

  await recordAuditEvent({
    action: "rate_set.delete",
    entity: "rate_set",
    entityId: result.id,
    permission: "rate_sets.delete",
    before: mapDbRowToApi(existingRow),
  });

  return result;
}
