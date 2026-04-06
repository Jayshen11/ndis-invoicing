import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { isWellFormedSessionId, NDIS_SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import {
  createErrorResponse,
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { findActiveAuthSessionById } from "@/repositories/auth-session.repository";
import { changePasswordForSessionUser } from "@/services/auth-change-password.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const raw = request.cookies.get(NDIS_SESSION_COOKIE_NAME)?.value?.trim() ?? "";

    if (raw === "" || !isWellFormedSessionId(raw)) {
      return createErrorResponse(
        new ApiError(401, "UNAUTHORIZED", "Authentication is required."),
      );
    }

    const session = await findActiveAuthSessionById(raw);

    if (!session) {
      return createErrorResponse(
        new ApiError(401, "UNAUTHORIZED", "Authentication is required."),
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "Request body must be JSON.");
    }

    await changePasswordForSessionUser(session.user_id, body);

    return createSuccessResponse({ success: true });
  } catch (error) {
    return handleRouteError(
      "Auth change-password route failed.",
      error,
      "Failed to change password.",
    );
  }
}
