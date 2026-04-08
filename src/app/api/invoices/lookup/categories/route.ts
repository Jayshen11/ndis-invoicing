/**
 * NDIS categories available under a rate set (invoice line helpers).
 *
 * **Boundary:** `invoices.read` — requires `rate_set_id` query param.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { listRateSetCategories } from "@/repositories/rate-set-invoice.repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `invoices.read` — `{ data }` list from `listRateSetCategories`. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.read");

    const raw = request.nextUrl.searchParams.get("rate_set_id");
    const id = raw === null ? NaN : Number.parseInt(raw, 10);

    if (!Number.isInteger(id) || id < 1) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        { field: "rate_set_id", message: "Must be a positive integer." },
      ]);
    }

    const rows = await listRateSetCategories(id);

    return createSuccessResponse(rows);
  } catch (error) {
    return handleRouteError(
      "Invoice categories lookup failed.",
      error,
      "Failed to load categories.",
    );
  }
}
