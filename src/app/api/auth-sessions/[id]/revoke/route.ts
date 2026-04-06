import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { revokeAuthSession } from "@/services/auth-session.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ id: string }>;
}>;

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "auth_sessions.revoke");

    const { id } = await context.params;
    const row = await revokeAuthSession(id);

    return createSuccessResponse(row);
  } catch (error) {
    return handleRouteError(
      "Auth session revoke route failed.",
      error,
      "Failed to revoke session.",
    );
  }
}
