/**
 * Current session bootstrap for the SPA: user, session id, CSRF token (from HttpOnly cookie).
 *
 * **Boundary:** No `requireApiAuth` — reads `NDIS_SESSION_COOKIE`; 401 JSON if missing/invalid.
 */
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { NDIS_SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import {
  createErrorResponse,
  createSuccessResponse,
} from "@/lib/api/response";
import { getAuthMePayload } from "@/services/auth-me.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cookie session → `{ data: { user, sessionId, csrfToken } }` or 401. */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.cookies.get(NDIS_SESSION_COOKIE_NAME)?.value;
    const payload = await getAuthMePayload(sessionId);

    if (!payload) {
      return createErrorResponse(
        new ApiError(401, "UNAUTHORIZED", "Authentication is required."),
      );
    }

    return createSuccessResponse({
      sessionId: payload.sessionId,
      user: payload.user,
      csrfToken: payload.csrfToken,
    });
  } catch (error) {
    console.error("Auth me route failed.", error);

    return createErrorResponse(
      new ApiError(500, "INTERNAL_ERROR", "Failed to load session."),
    );
  }
}
