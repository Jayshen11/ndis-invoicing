/**
 * Upload invoice PDF; optional OpenAI-based field extraction (`OPENAI_API_KEY` required).
 *
 * **Boundary:** `invoices.write` — multipart `file`, size cap; delegates to `invoice-pdf-extract.service`.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { extractInvoicePdfForApi } from "@/services/invoice-pdf-extract.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 12 * 1024 * 1024;

function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") {
    return true;
  }

  const name = file.name.toLowerCase();

  return name.endsWith(".pdf");
}

/** `invoices.write` — returns extracted draft fields in `{ data }` or 503 if unconfigured. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.write");

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        { field: "file", message: "A PDF file is required." },
      ]);
    }

    if (!isPdfFile(file)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        { field: "file", message: "Only PDF uploads are allowed." },
      ]);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        { field: "file", message: "The file is empty." },
      ]);
    }

    if (buffer.length > MAX_PDF_BYTES) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "file",
          message: `PDF must be at most ${MAX_PDF_BYTES} bytes.`,
        },
      ]);
    }

    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new ApiError(
        503,
        "SERVICE_UNAVAILABLE",
        "PDF extraction is not configured (set OPENAI_API_KEY).",
      );
    }

    const data = await extractInvoicePdfForApi(buffer);

    return createSuccessResponse(data);
  } catch (error) {
    return handleRouteError(
      "Invoice PDF extraction failed.",
      error,
      "Could not extract invoice from PDF.",
    );
  }
}
