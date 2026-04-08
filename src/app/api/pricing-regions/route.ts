/**
 * NDIS pricing region codes/labels for rate-set and invoice UI.
 *
 * **Boundary:** `rate_sets.read` → `pricing-region.service`; returns `{ data: { pricingRegions }, meta }`.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { listPricingRegions } from "@/services/pricing-region.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `rate_sets.read` — full list with count in `meta`. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "rate_sets.read");

    const pricingRegions = await listPricingRegions();

    return createSuccessResponse(
      {
        pricingRegions,
      },
      {
        meta: {
          count: pricingRegions.length,
        },
      },
    );
  } catch (error) {
    return handleRouteError(
      "Pricing region list route failed.",
      error,
      "Failed to load pricing regions.",
    );
  }
}
