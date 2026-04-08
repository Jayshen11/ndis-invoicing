/**
 * Paginated audit log entries (who did what, on which entity).
 *
 * **Boundary:** `requireApiAuth` + `audit_logs.read` → `audit-log.service`. Responses use `{ data, pagination? }`.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { listAuditLogsPage } from "@/services/audit-log.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `audit_logs.read` — query params parsed in service for filters/page. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "audit_logs.read");

    const { data, pagination } = await listAuditLogsPage(
      request.nextUrl.searchParams,
    );

    return createSuccessResponse(data, { pagination });
  } catch (error) {
    return handleRouteError(
      "Audit log list route failed.",
      error,
      "Failed to load audit logs.",
    );
  }
}
