import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { listRbacRoleOptions } from "@/services/user-role.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireApiAuth(_request);
    requirePermission(auth, "user_roles.read");

    const data = await listRbacRoleOptions();

    return createSuccessResponse(data);
  } catch (error) {
    return handleRouteError(
      "RBAC role options route failed.",
      error,
      "Failed to load role options.",
    );
  }
}
