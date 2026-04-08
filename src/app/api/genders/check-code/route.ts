/**
 * Form UX: whether a gender `code` is already taken (`{ exists: boolean }`).
 *
 * **Boundary:** `genders.write` — minimal JSON, `Cache-Control: no-store`.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { handleRouteError } from "@/lib/api/response";
import { checkGenderCodeExists } from "@/services/gender.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_CODE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

/** `genders.write` — query params parsed in `gender.service`. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "genders.write");

    const { exists } = await checkGenderCodeExists(
      request.nextUrl.searchParams,
    );

    return NextResponse.json({ exists }, { headers: CHECK_CODE_RESPONSE_HEADERS });
  } catch (error) {
    return handleRouteError(
      "Gender code availability route failed.",
      error,
      "Failed to check gender code.",
    );
  }
}
