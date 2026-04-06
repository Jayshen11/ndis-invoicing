import { ApiError } from "@/lib/api/errors";
import { listActivePricingRegionRows } from "@/repositories/pricing-region.repository";
import {
  mapPricingRegionRow,
  type PricingRegionOption,
} from "@/modules/rate-set/types";

export async function listPricingRegions(): Promise<PricingRegionOption[]> {
  try {
    const rows = await listActivePricingRegionRows();

    return rows.map(mapPricingRegionRow);
  } catch (error) {
    throw translatePricingRegionError(error);
  }
}

function translatePricingRegionError(error: unknown): ApiError | Error {
  const code = getDatabaseErrorCode(error);

  if (code === "42P01") {
    return new ApiError(
      503,
      "PRICING_REGION_TABLE_UNAVAILABLE",
      "Pricing region table is not available.",
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown pricing region repository error.");
}

function getDatabaseErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}
