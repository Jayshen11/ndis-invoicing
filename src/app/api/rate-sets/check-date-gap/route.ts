/**
 * Detect gaps between rate-set coverage and a proposed range (form UX).
 *
 * **Boundary:** `rate_sets.read` — service-shaped JSON, `Cache-Control: no-store`.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { handleRouteError } from "@/lib/api/response";
import { checkRateSetDateGap } from "@/services/rate-set.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_DATE_GAP_HEADERS = {
  "Cache-Control": "no-store",
} as const;

/** `rate_sets.read` — query params forwarded to `checkRateSetDateGap`. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "rate_sets.read");

    const result = await checkRateSetDateGap(request.nextUrl.searchParams);

    return NextResponse.json(result, {
      headers: CHECK_DATE_GAP_HEADERS,
    });
  } catch (error) {
    return handleRouteError(
      "Rate set date gap check route failed.",
      error,
      "Failed to check rate set date gap.",
    );
  }
}
