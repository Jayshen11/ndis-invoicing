/**
 * Single provider by `[id]` — load, update, delete.
 *
 * **Boundary:** `provider.service`; `[id]` is provider primary key.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import {
  deleteProvider,
  getProvider,
  updateProvider,
} from "@/services/provider.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/** `providers.read` — one provider. */
export async function GET(
  request: NextRequest,
  context: ProviderRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "providers.read");

    const { id } = await context.params;
    const provider = await getProvider(id);

    return createSuccessResponse(provider);
  } catch (error) {
    return handleRouteError(
      "Provider detail route failed.",
      error,
      "Failed to load provider.",
    );
  }
}

/** `providers.write` — partial update. */
export async function PATCH(
  request: NextRequest,
  context: ProviderRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "providers.write");

    const { id } = await context.params;
    const payload = await readJsonRequestBody(request);
    const provider = await updateProvider(id, payload);

    return createSuccessResponse(provider);
  } catch (error) {
    return handleRouteError(
      "Provider update route failed.",
      error,
      "Failed to update provider.",
    );
  }
}

/** `providers.delete` — delete provider per service rules. */
export async function DELETE(
  request: NextRequest,
  context: ProviderRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "providers.delete");

    const { id } = await context.params;
    const deleted = await deleteProvider(id);

    return createSuccessResponse(deleted);
  } catch (error) {
    return handleRouteError(
      "Provider delete route failed.",
      error,
      "Failed to delete provider.",
    );
  }
}
