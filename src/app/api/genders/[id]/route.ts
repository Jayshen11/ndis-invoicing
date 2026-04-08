/**
 * Gender catalogue row by `[id]` — read, update, soft-delete.
 *
 * **Boundary:** `gender.service`; `[id]` is gender primary key.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { getGender, markGenderDeleted, updateGender } from "@/services/gender.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenderRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/** `genders.read` — one row. */
export async function GET(
  request: NextRequest,
  context: GenderRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "genders.read");

    const { id } = await context.params;
    const row = await getGender(id);

    return createSuccessResponse(row);
  } catch (error) {
    return handleRouteError(
      "Gender detail route failed.",
      error,
      "Failed to load gender.",
    );
  }
}

/** `genders.write` — partial update. */
export async function PATCH(
  request: NextRequest,
  context: GenderRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "genders.write");

    const { id } = await context.params;
    const payload = await readJsonRequestBody(request);
    const row = await updateGender(id, payload);

    return createSuccessResponse(row);
  } catch (error) {
    return handleRouteError(
      "Gender update route failed.",
      error,
      "Failed to update gender.",
    );
  }
}

/** `genders.delete` — soft-delete catalogue row. */
export async function DELETE(
  request: NextRequest,
  context: GenderRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "genders.delete");

    const { id } = await context.params;
    const row = await markGenderDeleted(id);

    return createSuccessResponse(row, { status: 200 });
  } catch (error) {
    return handleRouteError(
      "Gender delete route failed.",
      error,
      "Failed to delete gender.",
    );
  }
}
