import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { listAuditLogActionOptions } from "@/services/audit-log.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "audit_logs.read");
    return createSuccessResponse(listAuditLogActionOptions());
  } catch (error) {
    return handleRouteError(
      "Audit log action options route failed.",
      error,
      "Failed to load audit action options.",
    );
  }
}
