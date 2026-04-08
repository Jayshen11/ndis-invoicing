/**
 * RBAC roles (`rbac_role` / user-role domain) — paginated list and create.
 *
 * **Boundary:** `user_roles.read` / `user_roles.write` → `user-role.service`.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import {
  createUserRole,
  listUserRolesPage,
} from "@/services/user-role.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "user_roles.read");

    const { data, pagination } = await listUserRolesPage(
      request.nextUrl.searchParams,
    );

    return createSuccessResponse(data, { pagination });
  } catch (error) {
    return handleRouteError(
      "RBAC roles list route failed.",
      error,
      "Failed to load roles.",
    );
  }
}

/** `user_roles.write` — create role; JSON validated in service. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "user_roles.write");

    const payload = await readJsonRequestBody(request);
    const row = await createUserRole(payload);

    return createSuccessResponse(row, { status: 201 });
  } catch (error) {
    return handleRouteError(
      "RBAC role create route failed.",
      error,
      "Failed to create role.",
    );
  }
}
