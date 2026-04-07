import { ApiError, isApiError } from "@/lib/api/errors";
import { uploadInvoicePdfToS3 } from "@/lib/s3-invoice-pdf";
import {
  findActiveClientIdByNdisDigits,
  getClientPricingRegionByClientId,
} from "@/repositories/client.repository";
import { findActiveProviderIdByAbnDigits } from "@/repositories/provider.repository";
import {
  findSupportItemInRateSetByItemNumber,
  listMatchingUnitPrices,
  listOverlappingRateSetIds,
  listRateSetCategories,
  listSupportItemsForCategory,
} from "@/repositories/rate-set-invoice.repository";
import type {
  InvoicePdfExtractLinePayload,
  InvoicePdfExtractLookupOption,
  InvoicePdfExtractResponse,
} from "@/modules/invoice/types";

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_PDF_TEXT_CHARS = 100_000;

type RawAiItem = {
  service_start_date?: unknown;
  service_end_date?: unknown;
  support_item_number?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
  amount?: unknown;
};

type RawAiInvoice = {
  invoice_number?: unknown;
  invoice_date?: unknown;
  total_amount?: unknown;
  provider_abn?: unknown;
  participant_ndis_number?: unknown;
  items?: unknown;
};

function digitsOnly(input: string | null | undefined): string {
  return String(input ?? "").replace(/\D/g, "");
}

function toTrimmedString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function toYmdOrEmpty(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const t = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return "";
  }

  return t;
}

function formatMoney2(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = value;

    return (Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100).toFixed(2);
  }

  if (typeof value === "string") {
    const n = Number.parseFloat(value.trim());

    if (!Number.isFinite(n)) {
      return null;
    }

    return (Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100).toFixed(2);
  }

  return null;
}

function roundPriceString(prices: string[]): string | null {
  if (prices.length !== 1) {
    return null;
  }

  const n = Number.parseFloat(prices[0]!);

  if (!Number.isFinite(n)) {
    return null;
  }

  return (Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100).toFixed(2);
}

async function parsePdfToText(buffer: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const pdfParse = mod.default as (
    data: Buffer,
  ) => Promise<{ text?: string } | undefined>;
  const result = await pdfParse(buffer);
  const text = typeof result?.text === "string" ? result.text : "";

  return text.replace(/\u0000/g, " ").trim();
}

function coerceItems(raw: unknown): RawAiItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((x) => x !== null && typeof x === "object") as RawAiItem[];
}

function safeJsonParseObject(content: string): RawAiInvoice | null {
  const trimmed = content.trim();

  try {
    const parsed: unknown = JSON.parse(trimmed);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as RawAiInvoice)
      : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start === -1 || end <= start) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));

      return typeof parsed === "object" && parsed !== null
        ? (parsed as RawAiInvoice)
        : null;
    } catch {
      return null;
    }
  }
}

async function callOpenAiForInvoiceJson(
  pdfText: string,
  documentUrl: string | null,
): Promise<RawAiInvoice> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const base =
    process.env.OPENAI_BASE_URL?.replace(/\/$/, "") ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const url = `${base}/chat/completions`;

  const urlNote =
    documentUrl === null
      ? "No separate document URL is available; rely only on the extracted text."
      : `A private time-limited document URL (same PDF) is: ${documentUrl}`;

  const system = `You extract NDIS invoice data from noisy PDF text. Return ONLY valid JSON (no markdown).
Use this shape (omit unknown fields or use null; arrays may be empty):
{
  "invoice_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "total_amount": number | null,
  "provider_abn": string | null,
  "participant_ndis_number": string | null,
  "items": [
    {
      "service_start_date": "YYYY-MM-DD" | null,
      "service_end_date": "YYYY-MM-DD" | null,
      "support_item_number": string | null,
      "quantity": number | null,
      "unit_price": number | null,
      "amount": number | null
    }
  ]
}
Rules:
- Map invoice total / grand total / balance due / amount payable into total_amount when it is clearly the invoice total.
- participant_ndis_number: participant NDIS number as printed (digits; spaces ok in string).
- provider_abn: Australian ABN as printed.
- support_item_number: NDIS support item / item code (often like 01_011_0107_1_1).
- If service_end_date is missing, set it null (server will default to start).
- If a field is not present, use null. Never invent NDIS numbers or ABNs.
- quantity is units/qty for the line.`;

  const user = `${urlNote}

--- PDF TEXT (may be incomplete) ---
${pdfText.slice(0, MAX_PDF_TEXT_CHARS)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 120_000);

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(
        504,
        "EXTRACT_TIMEOUT",
        "PDF extraction timed out. Try a smaller file or try again.",
      );
    }

    console.error("OpenAI request network failure.", error);
    throw new ApiError(
      502,
      "EXTRACT_AI_UNAVAILABLE",
      "Could not reach the document extraction service. Check server network and OPENAI_BASE_URL.",
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    console.error(
      "OpenAI chat completions failed.",
      response.status,
      errBody.slice(0, 800),
    );

    if (response.status === 429) {
      throw new ApiError(
        429,
        "EXTRACT_RATE_LIMIT",
        "Extraction rate limit reached. Wait a moment and try again.",
      );
    }

    if (response.status === 401) {
      throw new ApiError(
        502,
        "EXTRACT_AI_AUTH",
        "OpenAI API key is invalid or expired. Check OPENAI_API_KEY on the server.",
      );
    }

    throw new ApiError(
      502,
      "EXTRACT_AI_FAILED",
      `Document extraction failed (upstream status ${response.status}). See server logs for details.`,
    );
  }

  const payload: unknown = await response.json();
  const record = payload as {
    choices?: { message?: { content?: string } }[];
  };
  const content = record.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    console.error("OpenAI returned an unexpected payload shape.");
    throw new ApiError(
      502,
      "EXTRACT_AI_PAYLOAD",
      "The extraction service returned an unexpected response. Try again or use another PDF.",
    );
  }

  const parsed = safeJsonParseObject(content);

  return parsed ?? {};
}

async function buildLinePayload(
  item: RawAiItem,
  pricingRegion: string | null,
  warnings: string[],
  lineIndex: number,
): Promise<InvoicePdfExtractLinePayload> {
  const lineWarnings: string[] = [];
  let start = toYmdOrEmpty(item.service_start_date);
  let end = toYmdOrEmpty(item.service_end_date);

  if (end === "" && start !== "") {
    end = start;
  }

  if (start === "" && end !== "") {
    start = end;
  }

  if (start === "" || end === "") {
    lineWarnings.push("Service dates missing or unparseable.");
  }

  if (start !== "" && end !== "" && end < start) {
    lineWarnings.push("Service end date before start date; please correct.");
  }

  const supportRaw = toTrimmedString(item.support_item_number);
  const unitStr = formatMoney2(item.quantity);
  const inputRateStr = formatMoney2(item.unit_price);

  let rateSetId: number | null = null;
  let categoryId: number | null = null;
  let supportItemId: number | null = null;
  let maxRate: string | null = null;
  let categories: InvoicePdfExtractLookupOption[] = [];
  let supportItems: InvoicePdfExtractLookupOption[] = [];
  let rateSetMessage: string | null = null;

  if (start !== "" && end !== "" && end >= start) {
    const rateSetIds = await listOverlappingRateSetIds(start, end);

    if (rateSetIds.length === 0) {
      rateSetMessage = "No rate set matches these service dates.";
      lineWarnings.push(rateSetMessage);
    } else if (rateSetIds.length >= 2) {
      rateSetMessage = "Multiple rate sets match; adjust dates.";
      lineWarnings.push(rateSetMessage);
    } else {
      rateSetId = rateSetIds[0]!;
      categories = await listRateSetCategories(rateSetId);

      if (supportRaw !== "") {
        const resolved = await findSupportItemInRateSetByItemNumber(
          rateSetId,
          supportRaw,
        );

        if (resolved === null) {
          lineWarnings.push(
            `Support item "${supportRaw}" was not found in the resolved rate set.`,
          );
        } else {
          supportItemId = resolved.id;
          categoryId = resolved.category_id;
          supportItems = await listSupportItemsForCategory(categoryId);

          if (pricingRegion !== null && pricingRegion !== "") {
            const prices = await listMatchingUnitPrices(
              rateSetId,
              supportItemId,
              pricingRegion,
              start,
              end,
            );
            const single = roundPriceString(prices);

            if (single === null) {
              lineWarnings.push(
                "Max rate could not be resolved (check participant pricing region and price rows).",
              );
            } else {
              maxRate = single;
            }
          } else {
            lineWarnings.push(
              "Participant pricing region is required to resolve max rate.",
            );
          }
        }
      } else {
        lineWarnings.push("Support item number missing.");
      }
    }
  }

  if (lineWarnings.length > 0) {
    warnings.push(`Line ${lineIndex + 1}: ${lineWarnings.join(" ")}`);
  }

  return {
    start_date: start,
    end_date: end,
    rate_set_id: rateSetId,
    category_id: categoryId,
    support_item_id: supportItemId,
    max_rate: maxRate,
    unit: unitStr,
    input_rate: inputRateStr,
    categories,
    supportItems,
    rate_set_message: rateSetMessage,
    line_warnings: lineWarnings,
    raw_support_item_number: supportRaw === "" ? null : supportRaw,
  };
}

export function assertPdfBufferWithinLimit(buffer: Buffer): void {
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error(`PDF exceeds ${MAX_PDF_BYTES} bytes.`);
  }
}

export async function extractInvoicePdfForApi(
  buffer: Buffer,
): Promise<InvoicePdfExtractResponse> {
  assertPdfBufferWithinLimit(buffer);

  const warnings: string[] = [];
  let documentUrl: string | null = null;

  try {
    const uploaded = await uploadInvoicePdfToS3(buffer);

    if (uploaded !== null) {
      documentUrl = uploaded.signedGetUrl;
    } else {
      warnings.push(
        "S3 upload skipped (bucket/region not configured); extraction uses PDF text only.",
      );
    }
  } catch {
    warnings.push("S3 upload failed; extraction continues from PDF text only.");
  }

  let pdfText = "";

  try {
    pdfText = await parsePdfToText(buffer);
  } catch {
    warnings.push("Could not parse PDF text; AI will see an empty body.");
  }

  if (pdfText === "") {
    warnings.push("No text extracted from PDF (scanned PDFs may need OCR).");
  }

  let raw: RawAiInvoice;

  try {
    raw = await callOpenAiForInvoiceJson(pdfText, documentUrl);
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }

    console.error("Invoice PDF extraction failed (unexpected).", error);
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Could not extract invoice from PDF.",
    );
  }

  const invoiceNumber = toTrimmedString(raw.invoice_number);
  const invoiceDate = toYmdOrEmpty(raw.invoice_date);
  const expectedAmount = formatMoney2(raw.total_amount);
  const participantDigits = digitsOnly(toTrimmedString(raw.participant_ndis_number));
  const abnDigits = digitsOnly(toTrimmedString(raw.provider_abn));

  const clientId = await findActiveClientIdByNdisDigits(participantDigits);
  const providerId = await findActiveProviderIdByAbnDigits(abnDigits);

  if (participantDigits !== "" && clientId === null) {
    warnings.push(
      "Participant NDIS number did not match exactly one active participant.",
    );
  }

  if (abnDigits !== "" && providerId === null) {
    warnings.push("Provider ABN did not match exactly one active provider.");
  }

  const pricingRegion =
    clientId !== null
      ? await getClientPricingRegionByClientId(clientId)
      : null;

  if (clientId !== null && (pricingRegion === null || pricingRegion === "")) {
    warnings.push("Matched participant has no pricing region; max rates may be missing.");
  }

  const items = coerceItems(raw.items);
  const lines: InvoicePdfExtractLinePayload[] = [];

  for (let i = 0; i < items.length; i += 1) {
    lines.push(await buildLinePayload(items[i]!, pricingRegion, warnings, i));
  }

  if (items.length === 0) {
    warnings.push("No line items were extracted.");
  }

  return {
    client_id: clientId,
    provider_id: providerId,
    invoice_number: invoiceNumber === "" ? null : invoiceNumber,
    invoice_date: invoiceDate === "" ? null : invoiceDate,
    expected_amount: expectedAmount,
    amount: expectedAmount,
    lines,
    warnings,
  };
}
