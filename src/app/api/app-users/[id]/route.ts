/**
 * App user by id — HTTP API for a single dashboard user (`app_user` + RBAC role).
 *
 * **Boundary:** Auth + RBAC + parse → `app-user.service` / `app-user.repository` (no business logic in this file).
 *
 * **Responses:** Success bodies use `{ data: ... }` via `createSuccessResponse`.
 * Errors are normalized by `handleRouteError` (never leak stack traces to clients).
 *
 * **Path:** `[id]` is the numeric `app_user.id` (string in the URL, parsed in the service).
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import {
  getAppUser,
  markAppUserDeleted,
  updateAppUser,
} from "@/services/app-user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AppUserRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/** `users.read` — returns one sanitized `AppUserApiRecord` (no password hash). */
export async function GET(
  request: NextRequest,
  context: AppUserRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "users.read");

    const { id } = await context.params;
    const row = await getAppUser(id);

    return createSuccessResponse(row);
  } catch (error) {
    return handleRouteError(
      "App user detail route failed.",
      error,
      "Failed to load user.",
    );
  }
}

/** `users.write` — JSON body validated in service; optional password change hashes with Argon2. */
export async function PATCH(
  request: NextRequest,
  context: AppUserRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "users.write");

    const { id } = await context.params;
    const payload = await readJsonRequestBody(request);
    const row = await updateAppUser(id, payload);

    return createSuccessResponse(row);
  } catch (error) {
    return handleRouteError(
      "App user update route failed.",
      error,
      "Failed to update user.",
    );
  }
}

/** `users.delete` — soft-deletes the row; default/system user cannot be removed (403 from service). */
export async function DELETE(
  request: NextRequest,
  context: AppUserRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "users.delete");

    const { id } = await context.params;
    const row = await markAppUserDeleted(id);

    return createSuccessResponse(row, { status: 200 });
  } catch (error) {
    return handleRouteError(
      "App user delete route failed.",
      error,
      "Failed to delete user.",
    );
  }
}
