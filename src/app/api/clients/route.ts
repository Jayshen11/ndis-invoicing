/**
 * Participants (clients) — full list for admin screens and create.
 *
 * **Boundary:** `clients.read` / `clients.write` → `client.service`. List returns `{ data: { clients }, meta }` (not paginated here).
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { mapClientToApiRecord } from "@/modules/client/types";
import { createClient, listClients } from "@/services/client.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `clients.read` — all clients (count in `meta`). */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "clients.read");

    const clients = await listClients();

    return createSuccessResponse(
      {
        clients,
      },
      {
        meta: {
          count: clients.length,
        },
      },
    );
  } catch (error) {
    return handleRouteError(
      "Clients list route failed.",
      error,
      "Failed to load clients.",
    );
  }
}

/** `clients.write` — create; body validated in service. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "clients.write");

    const payload = await readJsonRequestBody(request);
    const client = await createClient(payload);

    return createSuccessResponse(mapClientToApiRecord(client), {
      status: 201,
    });
  } catch (error) {
    return handleRouteError(
      "Client create route failed.",
      error,
      "Failed to create client.",
    );
  }
}
