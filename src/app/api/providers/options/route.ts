import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { listProviderOptionRows } from "@/repositories/provider.repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "providers.read");

    const rows = await listProviderOptionRows();

    return createSuccessResponse(rows);
  } catch (error) {
    return handleRouteError(
      "Provider options route failed.",
      error,
      "Failed to load providers.",
    );
  }
}
