import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NDIS_SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import { ApiError } from "@/lib/api/errors";
import type { AuthMePayload } from "@/services/auth-me.service";
import { getAuthMePayload } from "@/services/auth-me.service";

function safeEqual(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * SEC: Optional `Authorization: Bearer <INTERNAL_API_TOKEN>` bypasses per-permission checks
 * for trusted automation only. Prefer session RBAC for normal use.
 */
function internalServiceBearerMatches(request: NextRequest): boolean {
  const configuredToken = process.env.INTERNAL_API_TOKEN?.trim();

  if (!configuredToken) {
    return false;
  }

  const authorizationHeader = request.headers.get("authorization");

  if (!authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }

  const providedToken = authorizationHeader.slice("Bearer ".length).trim();

  return providedToken.length > 0 && safeEqual(configuredToken, providedToken);
}

export type ApiAuthContext =
  | { kind: "internal" }
  | { kind: "session"; payload: AuthMePayload };

/**
 * SEC: Resolves caller as valid `ndis_session` cookie or internal bearer (when configured).
 * When both a valid session and internal Bearer are present, **session wins** so RBAC is
 * always enforced for signed-in browsers (proxies must not attach INTERNAL_API_TOKEN to user traffic).
 * Unauthenticated requests throw 401.
 */
export async function requireApiAuth(
  request: NextRequest,
): Promise<ApiAuthContext> {
  const sessionId = request.cookies.get(NDIS_SESSION_COOKIE_NAME)?.value;
  const sessionPayload = await getAuthMePayload(sessionId);

  if (sessionPayload) {
    return { kind: "session", payload: sessionPayload };
  }

  if (internalServiceBearerMatches(request)) {
    return { kind: "internal" };
  }

  throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
}

/** SEC: Enforces RBAC slug from `rbac_permission` / session user's role grants. */
export function requirePermission(
  ctx: ApiAuthContext,
  permissionSlug: string,
): void {
  if (ctx.kind === "internal") {
    return;
  }

  if (!ctx.payload.user.permissions.includes(permissionSlug)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "You do not have permission to perform this action.",
    );
  }
}

export function requireAnyPermission(
  ctx: ApiAuthContext,
  permissionSlugs: readonly string[],
): void {
  if (ctx.kind === "internal") {
    return;
  }

  const granted = ctx.payload.user.permissions;

  if (!permissionSlugs.some((slug) => granted.includes(slug))) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "You do not have permission to perform this action.",
    );
  }
}
