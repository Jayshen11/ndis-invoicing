/**
 * Support items under a rate-set category (cascading invoice UI).
 *
 * **Boundary:** `invoices.read` — requires `category_id` query param.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { listSupportItemsForCategory } from "@/repositories/rate-set-invoice.repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `invoices.read` — `{ data }` from `listSupportItemsForCategory`. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.read");

    const raw = request.nextUrl.searchParams.get("category_id");
    const id = raw === null ? NaN : Number.parseInt(raw, 10);

    if (!Number.isInteger(id) || id < 1) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        { field: "category_id", message: "Must be a positive integer." },
      ]);
    }

    const rows = await listSupportItemsForCategory(id);

    return createSuccessResponse(rows);
  } catch (error) {
    return handleRouteError(
      "Invoice support items lookup failed.",
      error,
      "Failed to load support items.",
    );
  }
}
