/**
 * Compact `{ id, label }` (or similar) rows for user pickers.
 *
 * **Boundary:** `users.read` → `listAppUserOptions` in `app-user.service`.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { listAppUserOptions } from "@/services/app-user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `users.read` — all options in one `{ data }` array. */
export async function GET(_request: NextRequest) {
  try {
    const auth = await requireApiAuth(_request);
    requirePermission(auth, "users.read");

    const data = await listAppUserOptions();

    return createSuccessResponse(data);
  } catch (error) {
    return handleRouteError(
      "App user options route failed.",
      error,
      "Failed to load user options.",
    );
  }
}
