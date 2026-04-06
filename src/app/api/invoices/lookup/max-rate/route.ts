import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import { listMatchingUnitPrices } from "@/repositories/rate-set-invoice.repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "invoices.read");

    const sp = request.nextUrl.searchParams;
    const rateSetId = Number.parseInt(sp.get("rate_set_id") ?? "", 10);
    const supportItemId = Number.parseInt(sp.get("support_item_id") ?? "", 10);
    const start = sp.get("start_date")?.trim() ?? "";
    const end = sp.get("end_date")?.trim() ?? "";
    const region = sp.get("pricing_region")?.trim() ?? "";

    const details: { field: string; message: string }[] = [];

    if (!Number.isInteger(rateSetId) || rateSetId < 1) {
      details.push({
        field: "rate_set_id",
        message: "Must be a positive integer.",
      });
    }

    if (!Number.isInteger(supportItemId) || supportItemId < 1) {
      details.push({
        field: "support_item_id",
        message: "Must be a positive integer.",
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      details.push({
        field: "start_date",
        message: "Must be YYYY-MM-DD.",
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      details.push({
        field: "end_date",
        message: "Must be YYYY-MM-DD.",
      });
    }

    if (region === "") {
      details.push({
        field: "pricing_region",
        message: "This field is required.",
      });
    }

    if (details.length > 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
    }

    if (start > end) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "end_date",
          message: "Must be on or after start_date.",
        },
      ]);
    }

    const prices = await listMatchingUnitPrices(
      rateSetId,
      supportItemId,
      region,
      start,
      end,
    );

    if (prices.length === 0) {
      return createSuccessResponse({
        unit_price: null,
        match_count: 0,
      });
    }

    if (prices.length >= 2) {
      return createSuccessResponse({
        unit_price: null,
        match_count: prices.length,
        ambiguous: true,
      });
    }

    const n = Number.parseFloat(prices[0]!);

    return createSuccessResponse({
      unit_price: (Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100).toFixed(2),
      match_count: 1,
      ambiguous: false,
    });
  } catch (error) {
    return handleRouteError(
      "Invoice max-rate lookup failed.",
      error,
      "Failed to resolve max rate.",
    );
  }
}
