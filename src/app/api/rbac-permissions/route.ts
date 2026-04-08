/**
 * Flat RBAC permission catalog for role editors (DB-backed when seeded, else in-code fallback).
 *
 * **Boundary:** `user_roles.read` — see GET handler for source selection logic.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import {
  getRbacPermissionsApiRows,
} from "@/modules/user-role/permissions-catalog";
import {
  countRbacPermissionRows,
  listRbacPermissionRows,
} from "@/repositories/rbac-permission.repository";
import { ensureRbacRoleSchemaPatches } from "@/repositories/user-role.repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `user_roles.read` — prefers `rbac_permission` rows when table non-empty, else `permissions-catalog`. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "user_roles.read");

    await ensureRbacRoleSchemaPatches();

    const rowCount = await countRbacPermissionRows();
    const data =
      rowCount > 0
        ? await listRbacPermissionRows()
        : getRbacPermissionsApiRows();

    return createSuccessResponse(data);
  } catch (error) {
    return handleRouteError(
      "RBAC permissions catalog route failed.",
      error,
      "Failed to load permissions catalog.",
    );
  }
}
