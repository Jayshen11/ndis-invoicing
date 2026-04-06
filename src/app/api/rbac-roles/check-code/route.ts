import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { handleRouteError } from "@/lib/api/response";
import { checkUserRoleCodeExists } from "@/services/user-role.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_CODE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "user_roles.write");

    const { exists } = await checkUserRoleCodeExists(
      request.nextUrl.searchParams,
    );

    return NextResponse.json(
      { exists },
      { headers: CHECK_CODE_RESPONSE_HEADERS },
    );
  } catch (error) {
    return handleRouteError(
      "RBAC role code availability route failed.",
      error,
      "Failed to check role code.",
    );
  }
}
