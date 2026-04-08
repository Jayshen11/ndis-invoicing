/**
 * Single participant (client) by `[id]` — load, update, delete.
 *
 * **Boundary:** `client.service` + `mapClientToApiRecord`. `[id]` is the client primary key (string in URL).
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { mapClientToApiRecord } from "@/modules/client/types";
import {
  deleteClient,
  getClient,
  updateClient,
} from "@/services/client.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClientRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/** `clients.read` — one client as API record. */
export async function GET(
  request: NextRequest,
  context: ClientRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "clients.read");

    const { id } = await context.params;
    const client = await getClient(id);

    return createSuccessResponse(mapClientToApiRecord(client));
  } catch (error) {
    return handleRouteError(
      "Client detail route failed.",
      error,
      "Failed to load client.",
    );
  }
}

/** `clients.write` — partial update; body validated in service. */
export async function PATCH(
  request: NextRequest,
  context: ClientRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "clients.write");

    const { id } = await context.params;
    const payload = await readJsonRequestBody(request);
    const client = await updateClient(id, payload);

    return createSuccessResponse(mapClientToApiRecord(client));
  } catch (error) {
    return handleRouteError(
      "Client update route failed.",
      error,
      "Failed to update client.",
    );
  }
}

/** `clients.delete` — returns wrapped deleted client payload from service. */
export async function DELETE(
  request: NextRequest,
  context: ClientRouteContext,
) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "clients.delete");

    const { id } = await context.params;
    const deletedClient = await deleteClient(id);

    return createSuccessResponse({
      client: deletedClient,
    });
  } catch (error) {
    return handleRouteError(
      "Client delete route failed.",
      error,
      "Failed to delete client.",
    );
  }
}
