/**
 * Active login sessions — paginated admin view.
 *
 * **Boundary:** `auth_sessions.read` → `auth-session.service`.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { listAuthSessionsPage } from "@/services/auth-session.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `auth_sessions.read` — paginated list. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "auth_sessions.read");

    const { data, pagination } = await listAuthSessionsPage(
      request.nextUrl.searchParams,
    );

    return createSuccessResponse(data, { pagination });
  } catch (error) {
    return handleRouteError(
      "Auth sessions list route failed.",
      error,
      "Failed to load auth sessions.",
    );
  }
}
