/**
 * Participant rows for selects (id + display fields); reads from `client.repository`.
 *
 * **Boundary:** `clients.read` — thin wrapper over repository (no extra business rules).
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { listClientOptionRows } from "@/repositories/client.repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `clients.read` — `{ data }` is array of option rows. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "clients.read");

    const rows = await listClientOptionRows();

    return createSuccessResponse(rows);
  } catch (error) {
    return handleRouteError(
      "Client options route failed.",
      error,
      "Failed to load participants.",
    );
  }
}
