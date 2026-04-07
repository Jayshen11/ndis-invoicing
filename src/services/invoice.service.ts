import { ApiError } from "@/lib/api/errors";
import type {
  InvoiceDetailResponse,
  InvoiceListFilters,
} from "@/modules/invoice/types";
import {
  countInvoiceRows,
  invoiceNumberExistsForProvider,
  getInvoiceListRowById,
  listInvoiceItemRowsByInvoiceId,
  listInvoiceRows,
  softDeleteInvoiceRow,
} from "@/repositories/invoice.repository";
import { recordAuditEvent } from "@/services/audit-log.service";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 500;
const INVOICE_NUMBER_SEARCH_MAX = 200;

export type InvoiceListPage = {
  data: Awaited<ReturnType<typeof listInvoiceRows>>;
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

function parseOptionalPositiveInt(
  raw: string | null,
  field: string,
): number | null {
  if (raw === null || raw.trim() === "" || raw === "all") {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field,
        message: "Must be a positive integer or omitted.",
      },
    ]);
  }

  return parsed;
}

/** SEC: `YYYY-MM-DD` only; reject other shapes. */
function parseOptionalInvoiceDate(raw: string | null): string | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }

  const trimmed = raw.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "invoice_date",
        message: "Must be a date in YYYY-MM-DD format.",
      },
    ]);
  }

  return trimmed;
}

function parseInvoiceListFilters(
  searchParams: URLSearchParams,
): InvoiceListFilters {
  const rawSearch = searchParams.get("invoice_number")?.trim() ?? "";

  if (rawSearch.length > INVOICE_NUMBER_SEARCH_MAX) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "invoice_number",
        message: `Must be ${INVOICE_NUMBER_SEARCH_MAX} characters or fewer.`,
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
    invoiceNumberSearch: rawSearch,
    clientId: parseOptionalPositiveInt(
      searchParams.get("client_id"),
      "client_id",
    ),
    providerId: parseOptionalPositiveInt(
      searchParams.get("provider_id"),
      "provider_id",
    ),
    invoiceDate: parseOptionalInvoiceDate(searchParams.get("invoice_date")),
    limit,
    offset,
  };
}

export async function listInvoicesPage(
  searchParams: URLSearchParams,
): Promise<InvoiceListPage> {
  const filters = parseInvoiceListFilters(searchParams);

  const [total, rows] = await Promise.all([
    countInvoiceRows(filters),
    listInvoiceRows(filters),
  ]);

  return {
    data: rows,
    pagination: {
      limit: filters.limit,
      offset: filters.offset,
      total,
    },
  };
}

export async function checkInvoiceNumberExists(
  searchParams: URLSearchParams,
): Promise<{ exists: boolean }> {
  const invoiceNumber = searchParams.get("invoice_number")?.trim() ?? "";
  const providerIdRaw = searchParams.get("provider_id");
  const excludeInvoiceIdRaw = searchParams.get("exclude_id");

  if (invoiceNumber === "") {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "invoice_number",
        message: "This field is required.",
      },
    ]);
  }

  if (invoiceNumber.length > INVOICE_NUMBER_SEARCH_MAX) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "invoice_number",
        message: `Must be ${INVOICE_NUMBER_SEARCH_MAX} characters or fewer.`,
      },
    ]);
  }

  const providerId = parseOptionalPositiveInt(providerIdRaw, "provider_id");
  const excludeInvoiceId = parseOptionalPositiveInt(
    excludeInvoiceIdRaw,
    "exclude_id",
  );

  if (providerId === null) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "provider_id",
        message: "This field is required.",
      },
    ]);
  }

  return {
    exists: await invoiceNumberExistsForProvider(
      providerId,
      invoiceNumber,
      excludeInvoiceId,
    ),
  };
}

export async function getInvoiceDetail(
  invoiceIdValue: string,
): Promise<InvoiceDetailResponse> {
  const parsed = Number.parseInt(invoiceIdValue, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "id",
        message: "Invoice id must be a positive integer.",
      },
    ]);
  }

  const [invoice, items] = await Promise.all([
    getInvoiceListRowById(parsed),
    listInvoiceItemRowsByInvoiceId(parsed),
  ]);

  if (!invoice) {
    throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
  }

  return { invoice, items };
}

export async function deleteInvoice(
  invoiceIdValue: string,
): Promise<{ id: number; deleted_at: string }> {
  const parsed = Number.parseInt(invoiceIdValue, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "id",
        message: "Invoice id must be a positive integer.",
      },
    ]);
  }

  const existing = await getInvoiceListRowById(parsed);

  if (!existing) {
    throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
  }

  const result = await softDeleteInvoiceRow(parsed);

  if (!result) {
    throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
  }

  await recordAuditEvent({
    action: "invoice.delete",
    entity: "invoice",
    entityId: result.id,
    permission: "invoices.write",
    before: existing,
  });

  return result;
}
