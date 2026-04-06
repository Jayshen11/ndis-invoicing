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
