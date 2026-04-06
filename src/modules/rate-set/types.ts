export type RateSetListFilters = {
  search: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** `null` = all; `true` = active only; `false` = inactive only */
  activeOnly: boolean | null;
  limit: number;
  offset: number;
};

/** Row shape returned by GET /api/rate-sets (matches list UI contract). */
export type RateSetApiRow = {
  id: number;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deleted_at: string | null;
};

export type RateSetImportedState = {
  hasImportedRates: boolean;
};

export type RateSetDateOverlapCheckResponse = {
  exists: boolean;
  overlaps: string[];
};

export type RateSetDateGapCheckResponse = {
  hasGap: boolean;
  adjacent: string[];
};

export type RateSetImportGridColumn = {
  key: string;
  title: string;
};

export type RateSetImportGridCellValue = string | boolean | number | null;

export type RateSetImportGridRow = {
  id: string;
  [key: string]: RateSetImportGridCellValue;
};

export type RateSetImportGridData = {
  columns: RateSetImportGridColumn[];
  rows: RateSetImportGridRow[];
};

/** Body of `data` from POST /api/rate-sets/[id]/import-excel */
export type NdisExcelImportApiResult = {
  stats: {
    categoriesTouched: number;
    itemsTouched: number;
    priceRowsWritten: number;
    categoriesSoftDeleted: number;
    itemsSoftDeleted: number;
  };
  parseWarnings: string[];
};

export type PricingRegionRow = {
  code: string;
  label: string;
  full_label: string;
};

export type PricingRegionOption = {
  code: string;
  label: string;
  fullLabel: string;
};

export function mapPricingRegionRow(
  row: PricingRegionRow,
): PricingRegionOption {
  return {
    code: row.code,
    label: row.label,
    fullLabel: row.full_label,
  };
}
