import { sql } from "kysely";
import { db } from "@/db/client";
import type { PricingRegionRow } from "@/modules/rate-set/types";

export async function listActivePricingRegionRows(): Promise<PricingRegionRow[]> {
  const result = await sql<PricingRegionRow>`
    select
      code,
      label,
      full_label
    from rate_set_support_item_pricing_region
    where deactivated_at is null
    order by label asc, code asc
  `.execute(db);

  return result.rows;
}
