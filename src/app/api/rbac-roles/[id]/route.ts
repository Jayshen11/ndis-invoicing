import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { resolveAuditActorForApiAuth } from "@/services/audit-log.service";
import {
  getUserRole,
  markUserRoleDeleted,
  updateUserRole,
} from "@/services/user-role.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RbacRoleRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: NextRequest,
  context: RbacRoleRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "user_roles.read");

    const { id } = await context.params;
    const row = await getUserRole(id);

    return createSuccessResponse(row);
  } catch (error) {
    return handleRouteError(
      "RBAC role detail route failed.",
      error,
      "Failed to load role.",
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RbacRoleRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "user_roles.write");

    const { id } = await context.params;
    const payload = await readJsonRequestBody(request);
    const auditActor = await resolveAuditActorForApiAuth(auth);
    const row = await updateUserRole(id, payload, auditActor);

    return createSuccessResponse(row);
  } catch (error) {
    return handleRouteError(
      "RBAC role update route failed.",
      error,
      "Failed to update role.",
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: RbacRoleRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "user_roles.delete");

    const { id } = await context.params;
    const row = await markUserRoleDeleted(id);

    return createSuccessResponse(row, { status: 200 });
  } catch (error) {
    return handleRouteError(
      "RBAC role delete route failed.",
      error,
      "Failed to delete role.",
    );
  }
}
