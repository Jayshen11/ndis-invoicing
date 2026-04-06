import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { handleRouteError, RESPONSE_HEADERS } from "@/lib/api/response";
import { deleteAuthSession } from "@/services/auth-session.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ id: string }>;
}>;

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "auth_sessions.delete");

    const { id } = await context.params;
    await deleteAuthSession(id);

    return new NextResponse(null, { status: 204, headers: RESPONSE_HEADERS });
  } catch (error) {
    return handleRouteError(
      "Auth session delete route failed.",
      error,
      "Failed to delete session.",
    );
  }
}
