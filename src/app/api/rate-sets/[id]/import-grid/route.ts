/**
 * Imported NDIS grid rows for a rate set (for UI tables after Excel import).
 *
 * **Boundary:** `rate_sets.read` → `rate-set.service`; `[id]` is rate set id.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { getRateSetImportGrid } from "@/services/rate-set.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

/** `rate_sets.read` — grid payload for `[id]`. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "rate_sets.read");

    const { id } = await context.params;
    const result = await getRateSetImportGrid(id);

    return createSuccessResponse(result);
  } catch (error) {
    return handleRouteError(
      "Rate set import-grid route failed.",
      error,
      "Failed to load imported grid.",
    );
  }
}
