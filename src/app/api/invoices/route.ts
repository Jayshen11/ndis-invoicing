import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { createInvoice } from "@/services/invoice-create.service";
import { listInvoicesPage } from "@/services/invoice.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.read");

    const { data, pagination } = await listInvoicesPage(
      request.nextUrl.searchParams,
    );

    return createSuccessResponse(data, {
      pagination,
    });
  } catch (error) {
    return handleRouteError(
      "Invoice list route failed.",
      error,
      "Failed to load invoices.",
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.write");

    const payload = await readJsonRequestBody(request);
    const invoice = await createInvoice(payload);

    return createSuccessResponse(invoice, {
      status: 201,
    });
  } catch (error) {
    return handleRouteError(
      "Invoice create route failed.",
      error,
      "Failed to create invoice.",
    );
  }
}
