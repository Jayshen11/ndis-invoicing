import { ApiError } from "@/lib/api/errors";
import {
  NdisWorkbookParseError,
  type NdisExcelHeaderMeta,
  type NdisExcelLogicalRow,
  parseNdisPricingExcel,
} from "@/lib/ndis-excel/parse-ndis-excel";
import {
  applyNdisExcelImport,
  type NdisExcelImportStats,
  type RateSetDbExecutor,
} from "@/repositories/ndis-excel-import.repository";
import { ensureRateSetInvoiceSchema } from "@/repositories/rate-set-invoice.repository";
import { db } from "@/db/client";

/** node-pg / Postgres driver errors expose `code` (SQLSTATE). */
function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code: unknown }).code;

  return typeof code === "string" ? code : undefined;
}

/** SEC: Cap upload size before parsing in memory. */
export const NDIS_EXCEL_IMPORT_MAX_BYTES = 15 * 1024 * 1024;

export type NdisExcelImportResult = {
  stats: NdisExcelImportStats;
  parseWarnings: string[];
};

export type ParsedNdisExcelImport = {
  header: NdisExcelHeaderMeta;
  rows: NdisExcelLogicalRow[];
  parseWarnings: string[];
};

function parseRateSetIdParam(value: string): number {
  const parsed = Number.parseInt(value, 10);

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

export async function importNdisExcelForRateSet(
  rateSetIdParam: string,
  buffer: Buffer,
): Promise<NdisExcelImportResult> {
  const rateSetId = parseRateSetIdParam(rateSetIdParam);
  await ensureRateSetInvoiceSchema();
  const parsed = validateAndParseNdisExcelBuffer(buffer);

  return db.transaction().execute(async (trx) => {
    return applyParsedNdisExcelImport(trx, rateSetId, parsed);
  });
}

export function validateAndParseNdisExcelBuffer(
  buffer: Buffer,
): ParsedNdisExcelImport {
  validateNdisExcelImportBufferSize(buffer);

  try {
    const parsed = parseNdisPricingExcel(buffer);
    assertConsistentRateSetImportRows(parsed.rows);
    return parsed;
  } catch (error) {
    if (error instanceof NdisWorkbookParseError) {
      console.error("NDIS Excel parse failed.", error.code, error.message);
      throw new ApiError(400, "INVALID_WORKBOOK", error.message, [
        { message: error.message },
      ]);
    }

    // SEC: Do not echo unknown parser exceptions to the client.
    console.error("NDIS Excel parse failed.", error);
    throw new ApiError(
      400,
      "INVALID_WORKBOOK",
      "Could not read this workbook. Use the official NDIS Pricing Arrangements and Price Limits Excel export.",
      [],
    );
  }
}

function validateNdisExcelImportBufferSize(buffer: Buffer): void {
  if (buffer.length > NDIS_EXCEL_IMPORT_MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "file",
        message: `File must be ${NDIS_EXCEL_IMPORT_MAX_BYTES / (1024 * 1024)} MB or smaller.`,
      },
    ]);
  }

  if (buffer.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field: "file", message: "File is empty." },
    ]);
  }
}

function assertConsistentRateSetImportRows(
  rows: readonly NdisExcelLogicalRow[],
): void {
  const categoryByItem = new Map<string, string>();

  for (const r of rows) {
    const prev = categoryByItem.get(r.itemNumber);

    if (prev !== undefined && prev !== r.categoryNumber) {
      throw new ApiError(
        400,
        "INCONSISTENT_ITEM_CATEGORY",
        "Validation failed.",
        [
          {
            field: "file",
            message: `Support item ${r.itemNumber} appears under more than one category number in the file.`,
          },
        ],
      );
    }

    categoryByItem.set(r.itemNumber, r.categoryNumber);
  }
}

export async function applyParsedNdisExcelImport(
  executor: RateSetDbExecutor,
  rateSetId: number,
  parsed: ParsedNdisExcelImport,
): Promise<NdisExcelImportResult> {
  try {
    const stats = await applyNdisExcelImport(
      executor,
      rateSetId,
      parsed.header,
      parsed.rows,
    );

    return { stats, parseWarnings: parsed.parseWarnings };
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_SET_NOT_FOUND") {
      throw new ApiError(404, "RATE_SET_NOT_FOUND", "Rate set not found.");
    }

    if (error instanceof ApiError) {
      throw error;
    }

    const sqlState = pgErrorCode(error);

    // SEC: Log detail server-side; keep client messages generic.
    if (sqlState === "23505") {
      console.error("NDIS Excel import unique violation.", error);
      throw new ApiError(
        409,
        "IMPORT_DUPLICATE",
        "Import conflicts with existing data (duplicate keys). Check the workbook or clear conflicting rows.",
        [],
      );
    }

    if (sqlState === "23503") {
      console.error("NDIS Excel import foreign key violation.", error);
      throw new ApiError(
        400,
        "IMPORT_REFERENCE_ERROR",
        "Import references invalid catalogue data (e.g. region or type). Use the official NDIS pricing workbook.",
        [],
      );
    }

    console.error("NDIS Excel import transaction failed.", error);
    throw new ApiError(
      500,
      "IMPORT_FAILED",
      "Import failed. Try again later or contact support if it persists.",
      [],
    );
  }
}
