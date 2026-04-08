/**
 * Email/password sign-in: sets HttpOnly session cookie and returns user + CSRF in JSON.
 *
 * **Boundary:** Public route; `loginWithEmailPassword` records IP (from `X-Forwarded-For` / `X-Real-IP`) and User-Agent. ApiError responses use custom JSON shape (not only `handleRouteError`).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ApiError, isApiError } from "@/lib/api/errors";
import { NDIS_SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import {
  createSuccessResponse,
  RESPONSE_HEADERS,
} from "@/lib/api/response";
import { loginWithEmailPassword } from "@/services/auth-login.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  if (forwarded) {
    return forwarded;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();

  if (realIp) {
    return realIp;
  }

  return "";
}

function sessionMaxAgeSeconds(): number {
  const raw = process.env.AUTH_SESSION_MAX_AGE_SEC?.trim();

  if (!raw) {
    return 60 * 60 * 24;
  }

  const n = Number.parseInt(raw, 10);

  if (!Number.isInteger(n) || n < 60 || n > 60 * 60 * 24 * 30) {
    return 60 * 60 * 24;
  }

  return n;
}

/** JSON credentials → Set-Cookie + `{ data: { user, sessionId, csrfToken } }`. */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "Request body must be JSON.");
    }

    const userAgent = request.headers.get("user-agent") ?? "";
    const loginResult = await loginWithEmailPassword(body, {
      userAgent,
      ip: clientIp(request),
    });

    const maxAge = sessionMaxAgeSeconds();
    const response = createSuccessResponse({
      user: loginResult.user,
      // SEC: Also mirrored in HttpOnly cookie; body copy is for clients that need it (prefer cookie for auth).
      sessionId: loginResult.sessionId,
      csrfToken: loginResult.csrfToken,
    });

    response.cookies.set({
      name: NDIS_SESSION_COOKIE_NAME,
      value: loginResult.sessionId,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });

    return response;
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        },
        { status: error.status, headers: RESPONSE_HEADERS },
      );
    }

    console.error("Auth login route failed.", error);

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Sign in failed. Try again later.",
        },
      },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}
