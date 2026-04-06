import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { updateInvoice } from "@/services/invoice-create.service";
import { deleteInvoice, getInvoiceDetail } from "@/services/invoice.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.read");

    const { id } = await context.params;
    const result = await getInvoiceDetail(id);

    return createSuccessResponse(result, { status: 200 });
  } catch (error) {
    return handleRouteError(
      "Invoice detail route failed.",
      error,
      "Failed to load invoice.",
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.write");

    const { id } = await context.params;
    const payload = await readJsonRequestBody(request);
    const result = await updateInvoice(id, payload);

    return createSuccessResponse(result, { status: 200 });
  } catch (error) {
    return handleRouteError(
      "Invoice update route failed.",
      error,
      "Failed to update invoice.",
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.delete");

    const { id } = await context.params;
    const result = await deleteInvoice(id);

    return createSuccessResponse(result, { status: 200 });
  } catch (error) {
    return handleRouteError(
      "Invoice delete route failed.",
      error,
      "Failed to delete invoice.",
    );
  }
}
