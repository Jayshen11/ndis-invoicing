/**
 * Form UX: whether an invoice number already exists (`{ exists }`).
 *
 * **Boundary:** `invoices.read` — `Cache-Control: no-store`; query params in `invoice.service`.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { handleRouteError } from "@/lib/api/response";
import { checkInvoiceNumberExists } from "@/services/invoice.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_INVOICE_NUMBER_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

/** `invoices.read` — not wrapped in standard `{ data }` (legacy minimal shape). */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.read");

    const { exists } = await checkInvoiceNumberExists(
      request.nextUrl.searchParams,
    );

    return NextResponse.json(
      { exists },
      { headers: CHECK_INVOICE_NUMBER_RESPONSE_HEADERS },
    );
  } catch (error) {
    return handleRouteError(
      "Invoice number availability route failed.",
      error,
      "Failed to check invoice number.",
    );
  }
}
