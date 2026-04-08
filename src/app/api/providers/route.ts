/**
 * NDIS service providers — list and create.
 *
 * **Boundary:** `providers.read` / `providers.write` → `provider.service`.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import {
  createProvider,
  listProvidersPage,
} from "@/services/provider.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `providers.read` — paginated list from query string. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "providers.read");

    const { data, pagination } = await listProvidersPage(
      request.nextUrl.searchParams,
    );

    return createSuccessResponse(data, {
      pagination,
    });
  } catch (error) {
    return handleRouteError(
      "Provider list route failed.",
      error,
      "Failed to load providers.",
    );
  }
}

/** `providers.write` — JSON body validated in service. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "providers.write");

    const payload = await readJsonRequestBody(request);
    const provider = await createProvider(payload);

    return createSuccessResponse(provider, {
      status: 201,
    });
  } catch (error) {
    return handleRouteError(
      "Provider create route failed.",
      error,
      "Failed to create provider.",
    );
  }
}
