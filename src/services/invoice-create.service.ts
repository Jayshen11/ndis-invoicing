import { ApiError, type ApiErrorDetail } from "@/lib/api/errors";
import type { InvoiceListRow } from "@/modules/invoice/types";
import { getClientRowById } from "@/repositories/client.repository";
import {
  createInvoiceWithItems,
  getInvoiceListRowById,
  invoiceNumberExistsForProvider,
  updateInvoiceWithItems,
  type InvoiceItemInsertRow,
} from "@/repositories/invoice.repository";
import { getProviderRowById } from "@/repositories/provider.repository";
import {
  categoryBelongsToRateSet,
  listMatchingUnitPrices,
  listOverlappingRateSetIds,
  supportItemBelongsToCategory,
} from "@/repositories/rate-set-invoice.repository";
import { recordAuditEvent } from "@/services/audit-log.service";

const INVOICE_NUMBER_MAX = 200;

export type CreateInvoiceItemPayload = {
  start_date?: string | null;
  end_date?: string | null;
  rate_set_id?: number | null;
  category_id?: number | null;
  support_item_id?: number | null;
  max_rate?: string | null;
  unit?: string | null;
  input_rate?: string | null;
};

export type CreateInvoicePayload = {
  status: string;
  client_id: unknown;
  provider_id: unknown;
  invoice_number: unknown;
  invoice_date: unknown;
  expected_amount: unknown;
  items?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundMoney2(n: number): number {
  return Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;
}

function moneyToCents(s: string): number {
  return Math.round(Number.parseFloat(s) * 100);
}

function ymdStartUtc(ymd: string): string {
  return `${ymd}T00:00:00.000Z`;
}

function ymdEndUtc(ymd: string): string {
  return `${ymd}T23:59:59.999Z`;
}

function parseYmd(value: unknown, field: string, details: ApiErrorDetail[]): string | null {
  if (value === undefined || value === null) {
    details.push({ field, message: "This field is required." });
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    details.push({ field, message: "Must be a date in YYYY-MM-DD format." });
    return null;
  }

  return value.trim();
}

function parseOptionalYmd(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    details.push({ field, message: "Must be a date in YYYY-MM-DD format." });
    return null;
  }

  return value.trim();
}

function parseRequiredPositiveInt(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
): number | null {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  ) {
    details.push({ field, message: "This field is required." });
    return null;
  }

  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(n) || n < 1) {
    details.push({ field, message: "Must be a positive integer." });
    return null;
  }

  return n;
}

function parseRequiredDecimalString(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
): string | null {
  if (value === undefined || value === null || value === "") {
    details.push({ field, message: "This field is required." });
    return null;
  }

  const raw = typeof value === "number" ? String(value) : String(value).trim();
  const n = Number.parseFloat(raw);

  if (!Number.isFinite(n)) {
    details.push({ field, message: "Must be a valid decimal number." });
    return null;
  }

  return roundMoney2(n).toFixed(2);
}

function parseOptionalDecimalString(
  value: unknown,
  field: string,
  details: ApiErrorDetail[],
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const raw = typeof value === "number" ? String(value) : String(value).trim();
  const n = Number.parseFloat(raw);

  if (!Number.isFinite(n)) {
    details.push({ field, message: "Must be a valid decimal number." });
    return null;
  }

  return roundMoney2(n).toFixed(2);
}

function normalizeItemPayloads(raw: unknown): CreateInvoiceItemPayload[] {
  if (raw === undefined || raw === null) {
    return [];
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return (raw as CreateInvoiceItemPayload[]).filter((item) =>
    [
      item?.start_date,
      item?.end_date,
      item?.rate_set_id,
      item?.category_id,
      item?.support_item_id,
      item?.max_rate,
      item?.unit,
      item?.input_rate,
    ].some(
      (value) =>
        value !== undefined &&
        value !== null &&
        (typeof value !== "string" || value.trim() !== ""),
    ),
  );
}

async function validateAndBuildCompletedItems(
  items: CreateInvoiceItemPayload[],
  clientPricingRegion: string,
  details: ApiErrorDetail[],
): Promise<InvoiceItemInsertRow[]> {
  const out: InvoiceItemInsertRow[] = [];

  if (items.length === 0) {
    details.push({
      field: "items",
      message: "At least one invoice item is required to complete an invoice.",
    });
    return out;
  }

  for (let i = 0; i < items.length; i++) {
    const prefix = `items[${i}]`;
    const it = items[i] ?? {};
    const beforeLen = details.length;

    const start = parseYmd(it.start_date, `${prefix}.start_date`, details);
    const end = parseYmd(it.end_date, `${prefix}.end_date`, details);

    if (start && end && start > end) {
      details.push({
        field: `${prefix}.end_date`,
        message: "Must be on or after service start date.",
      });
    }

    if (!start || !end) {
      continue;
    }

    const clientRateSetId = parseRequiredPositiveInt(
      it.rate_set_id,
      `${prefix}.rate_set_id`,
      details,
    );

    const overlapIds = await listOverlappingRateSetIds(start, end);

    if (overlapIds.length === 0) {
      details.push({
        field: `${prefix}.rate_set_id`,
        message: "No rate set matches the selected service date range.",
      });
      continue;
    }

    if (overlapIds.length >= 2) {
      details.push({
        field: `${prefix}.rate_set_id`,
        message: "Multiple rate sets match the date range; resolve dates or rate data.",
      });
      continue;
    }

    const resolvedRateSetId = overlapIds[0]!;

    if (clientRateSetId !== null && clientRateSetId !== resolvedRateSetId) {
      details.push({
        field: `${prefix}.rate_set_id`,
        message: "Rate set does not match the overlapping rate set for these dates.",
      });
    }

    const catId = parseRequiredPositiveInt(
      it.category_id,
      `${prefix}.category_id`,
      details,
    );
    const supId = parseRequiredPositiveInt(
      it.support_item_id,
      `${prefix}.support_item_id`,
      details,
    );

    const unitStr = parseRequiredDecimalString(it.unit, `${prefix}.unit`, details);
    const inputRateStr = parseRequiredDecimalString(
      it.input_rate,
      `${prefix}.input_rate`,
      details,
    );

    if (!unitStr || !inputRateStr || catId === null || supId === null) {
      continue;
    }

    const catOk = await categoryBelongsToRateSet(catId, resolvedRateSetId);

    if (!catOk) {
      details.push({
        field: `${prefix}.category_id`,
        message: "Support category is not part of the resolved rate set.",
      });
    }

    const supOk = await supportItemBelongsToCategory(supId, catId);

    if (!supOk) {
      details.push({
        field: `${prefix}.support_item_id`,
        message: "Support item is not part of the selected category.",
      });
    }

    const prices = await listMatchingUnitPrices(
      resolvedRateSetId,
      supId,
      clientPricingRegion,
      start,
      end,
    );

    if (prices.length === 0) {
      details.push({
        field: `${prefix}.max_rate`,
        message: "No unit price found for this support item, region, and date range.",
      });
    } else if (prices.length >= 2) {
      details.push({
        field: `${prefix}.max_rate`,
        message: "Multiple unit prices match; pricing data must be unique for this range.",
      });
    }

    const maxRateStr =
      prices.length === 1
        ? roundMoney2(Number.parseFloat(prices[0]!)).toFixed(2)
        : null;

    const clientMax = parseRequiredDecimalString(
      it.max_rate,
      `${prefix}.max_rate`,
      details,
    );

    if (
      maxRateStr !== null &&
      clientMax !== null &&
      moneyToCents(clientMax) !== moneyToCents(maxRateStr)
    ) {
      details.push({
        field: `${prefix}.max_rate`,
        message: "Max rate does not match the scheduled price for this item.",
      });
    }

    if (
      clientMax !== null &&
      inputRateStr !== null &&
      moneyToCents(inputRateStr) > moneyToCents(clientMax)
    ) {
      details.push({
        field: `${prefix}.input_rate`,
        message: "Invoiced Rate must be less than or equal to Max Rate.",
      });
    }

    if (details.length > beforeLen || maxRateStr === null || clientMax === null) {
      continue;
    }

    const unitN = Number.parseFloat(unitStr);
    const lineAmount = roundMoney2(unitN * Number.parseFloat(inputRateStr)).toFixed(2);

    out.push({
      rateSetId: resolvedRateSetId,
      categoryId: catId,
      supportItemId: supId,
      startDateIso: ymdStartUtc(start),
      endDateIso: ymdEndUtc(end),
      maxRate: maxRateStr,
      unit: unitStr,
      inputRate: inputRateStr,
      amount: lineAmount,
      sortOrder: i,
    });
  }

  return out;
}

function ymdLoose(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }

  return value.trim();
}

function decimalLoose(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const raw = typeof value === "number" ? String(value) : String(value).trim();
  const n = Number.parseFloat(raw);

  if (!Number.isFinite(n)) {
    return null;
  }

  return roundMoney2(n).toFixed(2);
}

function intLoose(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const n = Number.parseInt(String(value), 10);

  if (!Number.isInteger(n) || n < 1) {
    return null;
  }

  return n;
}

function buildDraftItems(items: CreateInvoiceItemPayload[]): InvoiceItemInsertRow[] {
  return items.map((it, i) => {
    const start = ymdLoose(it.start_date);
    const end = ymdLoose(it.end_date);
    const rs = intLoose(it.rate_set_id);
    const cat = intLoose(it.category_id);
    const sup = intLoose(it.support_item_id);
    const unitStr = decimalLoose(it.unit);
    const inputRateStr = decimalLoose(it.input_rate);
    const maxStr = decimalLoose(it.max_rate);

    let amountStr: string | null = null;

    if (unitStr !== null && inputRateStr !== null) {
      amountStr = roundMoney2(
        Number.parseFloat(unitStr) * Number.parseFloat(inputRateStr),
      ).toFixed(2);
    }

    return {
      rateSetId: rs,
      categoryId: cat,
      supportItemId: sup,
      startDateIso: start ? ymdStartUtc(start) : null,
      endDateIso: end ? ymdEndUtc(end) : null,
      maxRate: maxStr,
      unit: unitStr,
      inputRate: inputRateStr,
      amount: amountStr,
      sortOrder: i,
    };
  });
}

async function saveInvoice(
  payload: unknown,
  existingInvoiceId: number | null,
): Promise<InvoiceListRow> {
  if (!isPlainObject(payload)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object.", []);
  }

  const body = payload as CreateInvoicePayload;
  const details: ApiErrorDetail[] = [];

  const status =
    body.status === "drafted" || body.status === "completed"
      ? body.status
      : null;

  if (status === null) {
    details.push({
      field: "status",
      message: 'Must be "drafted" or "completed".',
    });
  }

  const clientId = parseRequiredPositiveInt(body.client_id, "client_id", details);
  const providerId = parseRequiredPositiveInt(body.provider_id, "provider_id", details);

  if (typeof body.invoice_number !== "string" || body.invoice_number.trim() === "") {
    details.push({ field: "invoice_number", message: "This field is required." });
  } else if (body.invoice_number.trim().length > INVOICE_NUMBER_MAX) {
    details.push({
      field: "invoice_number",
      message: `Must be ${INVOICE_NUMBER_MAX} characters or fewer.`,
    });
  }

  const invoiceNumber =
    typeof body.invoice_number === "string" ? body.invoice_number.trim() : "";

  const invoiceDateYmd = parseYmd(body.invoice_date, "invoice_date", details);
  const expectedStr = parseRequiredDecimalString(
    body.expected_amount,
    "expected_amount",
    details,
  );

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  if (!clientId || !providerId || !invoiceDateYmd || !expectedStr || !status) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  let existingInvoice: InvoiceListRow | null = null;

  if (existingInvoiceId !== null) {
    const existing = await getInvoiceListRowById(existingInvoiceId);

    if (!existing) {
      throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
    }

    existingInvoice = existing;
  }

  const client = await getClientRowById(clientId);

  if (!client) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field: "client_id", message: "Participant not found." },
    ]);
  }

  const provider = await getProviderRowById(providerId);

  if (!provider) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field: "provider_id", message: "Provider not found." },
    ]);
  }

  const taken = await invoiceNumberExistsForProvider(
    providerId,
    invoiceNumber,
    existingInvoiceId,
  );

  if (taken) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "invoice_number",
        message: "This invoice number is already used for this provider.",
      },
    ]);
  }

  const itemsRaw = normalizeItemPayloads(body.items);
  const invoiceDateIso = ymdStartUtc(invoiceDateYmd);

  if (status === "drafted") {
    const rows = buildDraftItems(itemsRaw);
    const sum = rows.reduce((acc, r) => {
      if (r.amount === null) {
        return acc;
      }

      return acc + Number.parseFloat(r.amount);
    }, 0);
    const hasAnyAmount = rows.some((r) => r.amount !== null);
    const totalAmountStr = hasAnyAmount ? roundMoney2(sum).toFixed(2) : null;

    const invoiceId =
      existingInvoiceId === null
        ? await createInvoiceWithItems({
            clientId,
            providerId,
            invoiceNumber,
            invoiceDateIso,
            expectedAmount: expectedStr,
            amount: totalAmountStr,
            status: "drafted",
            items: rows,
          })
        : (await updateInvoiceWithItems({
            invoiceId: existingInvoiceId,
            clientId,
            providerId,
            invoiceNumber,
            invoiceDateIso,
            expectedAmount: expectedStr,
            amount: totalAmountStr,
            status: "drafted",
            items: rows,
          }),
          existingInvoiceId);

    const created = await getInvoiceListRowById(invoiceId);

    if (!created) {
      throw new ApiError(500, "INTERNAL_ERROR", "Failed to load created invoice.");
    }

    await recordAuditEvent({
      action: existingInvoiceId === null ? "invoice.create" : "invoice.update",
      entity: "invoice",
      entityId: created.id,
      permission: "invoices.write",
      before: existingInvoice,
      after: created,
    });

    return created;
  }

  const completedItems = await validateAndBuildCompletedItems(
    itemsRaw,
    client.pricing_region,
    details,
  );

  if (completedItems.length !== itemsRaw.length) {
    const hasItemsError = details.some((d) => d.field === "items");

    if (!hasItemsError) {
      details.push({
        field: "items",
        message: "Every line item must be valid before completing the invoice.",
      });
    }
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  const total = completedItems.reduce(
    (acc, r) => acc + Number.parseFloat(r.amount!),
    0,
  );
  const amountStr = roundMoney2(total).toFixed(2);

  if (moneyToCents(expectedStr) > moneyToCents(amountStr)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "expected_amount",
        message: "Expected amount cannot exceed the total invoiced amount.",
      },
    ]);
  }

  const invoiceId =
    existingInvoiceId === null
      ? await createInvoiceWithItems({
          clientId,
          providerId,
          invoiceNumber,
          invoiceDateIso,
          expectedAmount: expectedStr,
          amount: amountStr,
          status: "completed",
          items: completedItems,
        })
      : (await updateInvoiceWithItems({
          invoiceId: existingInvoiceId,
          clientId,
          providerId,
          invoiceNumber,
          invoiceDateIso,
          expectedAmount: expectedStr,
          amount: amountStr,
          status: "completed",
          items: completedItems,
        }),
        existingInvoiceId);

  const row = await getInvoiceListRowById(invoiceId);

  if (!row) {
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to load created invoice.");
  }

  await recordAuditEvent({
    action: existingInvoiceId === null ? "invoice.create" : "invoice.update",
    entity: "invoice",
    entityId: row.id,
    permission: "invoices.write",
    before: existingInvoice,
    after: row,
  });

  return row;
}

export async function createInvoice(
  payload: unknown,
): Promise<InvoiceListRow> {
  return saveInvoice(payload, null);
}

export async function updateInvoice(
  invoiceIdValue: string,
  payload: unknown,
): Promise<InvoiceListRow> {
  const invoiceId = Number.parseInt(invoiceIdValue, 10);

  if (!Number.isInteger(invoiceId) || invoiceId < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "id",
        message: "Invoice id must be a positive integer.",
      },
    ]);
  }

  return saveInvoice(payload, invoiceId);
}
