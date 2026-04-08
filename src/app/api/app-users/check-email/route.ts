/**
 * Form UX: whether an app-user email is already registered (`{ exists }`).
 *
 * **Boundary:** `users.write` — case-insensitive check in service; `Cache-Control: no-store`.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { handleRouteError } from "@/lib/api/response";
import { checkAppUserEmailExists } from "@/services/app-user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_EMAIL_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

/** `users.write` — query string holds email to test. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "users.write");

    const { exists } = await checkAppUserEmailExists(
      request.nextUrl.searchParams,
    );

    return NextResponse.json({ exists }, { headers: CHECK_EMAIL_RESPONSE_HEADERS });
  } catch (error) {
    return handleRouteError(
      "App user email availability route failed.",
      error,
      "Failed to check email.",
    );
  }
}
