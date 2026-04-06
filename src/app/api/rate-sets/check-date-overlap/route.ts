import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { handleRouteError } from "@/lib/api/response";
import { checkRateSetDateOverlap } from "@/services/rate-set.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_DATE_OVERLAP_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "rate_sets.read");

    const result = await checkRateSetDateOverlap(request.nextUrl.searchParams);

    return NextResponse.json(result, {
      headers: CHECK_DATE_OVERLAP_HEADERS,
    });
  } catch (error) {
    return handleRouteError(
      "Rate set date overlap check route failed.",
      error,
      "Failed to check rate set date overlap.",
    );
  }
}
