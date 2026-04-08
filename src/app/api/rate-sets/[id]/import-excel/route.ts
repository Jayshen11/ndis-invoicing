/**
 * Upload NDIS pricing workbook (`multipart/formData` field `file`) for an existing rate set.
 *
 * **Boundary:** `rate_sets.import` → `ndis-excel-import.service`; MIME/size checks here.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import {
  NDIS_EXCEL_IMPORT_MAX_BYTES,
  importNdisExcelForRateSet,
} from "@/services/ndis-excel-import.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

/** `rate_sets.import` — parses workbook and persists grid for `[id]`. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "rate_sets.import");

    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        { field: "file", message: "A spreadsheet file is required." },
      ]);
    }

    const mime = (file.type ?? "").trim().toLowerCase();

    if (mime !== "" && !ALLOWED_MIME.has(mime)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "file",
          message: "Only Excel workbooks (.xlsx / .xls) are allowed.",
        },
      ]);
    }

    const buf = Buffer.from(await file.arrayBuffer());

    if (buf.length > NDIS_EXCEL_IMPORT_MAX_BYTES) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "file",
          message: `File must be ${NDIS_EXCEL_IMPORT_MAX_BYTES / (1024 * 1024)} MB or smaller.`,
        },
      ]);
    }

    const result = await importNdisExcelForRateSet(id, buf);

    return createSuccessResponse(result, {
      meta: { parseWarnings: result.parseWarnings },
      status: 200,
    });
  } catch (error) {
    return handleRouteError(
      "Rate set Excel import route failed.",
      error,
      "Failed to import NDIS pricing workbook.",
    );
  }
}
