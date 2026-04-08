/**
 * Given invoice line date range, which rate set(s) apply (single id, ambiguous, or list).
 *
 * **Boundary:** `invoices.read` — validates `start_date` / `end_date`, then repository.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { listOverlappingRateSetIds } from "@/repositories/rate-set-invoice.repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseYmdParam(
  raw: string | null,
  field: string,
): string {
  if (raw === null || raw.trim() === "") {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field, message: "This field is required." },
    ]);
  }

  const v = raw.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field, message: "Must be YYYY-MM-DD." },
    ]);
  }

  return v;
}

/** `invoices.read` — `{ data: { rate_set_ids, rate_set_id, ambiguous } }`. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.read");

    const start = parseYmdParam(
      request.nextUrl.searchParams.get("start_date"),
      "start_date",
    );
    const end = parseYmdParam(
      request.nextUrl.searchParams.get("end_date"),
      "end_date",
    );

    if (start > end) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "end_date",
          message: "Must be on or after start_date.",
        },
      ]);
    }

    const rateSetIds = await listOverlappingRateSetIds(start, end);

    return createSuccessResponse({
      rate_set_ids: rateSetIds,
      rate_set_id: rateSetIds.length === 1 ? rateSetIds[0]! : null,
      ambiguous: rateSetIds.length >= 2,
    });
  } catch (error) {
    return handleRouteError(
      "Invoice rate-set lookup failed.",
      error,
      "Failed to resolve rate set.",
    );
  }
}
