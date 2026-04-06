"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import type {
  RateSetApiRow,
  RateSetImportGridCellValue,
  RateSetImportGridColumn,
  RateSetImportGridData,
  RateSetImportGridRow,
  RateSetImportedState,
} from "@/modules/rate-set/types";
import {
  ApiRequestError,
  fetchApiData,
  fetchRateSetDateGapCheck,
  fetchRateSetDateOverlapCheck,
  fetchApiListWithPagination,
  getRequestErrorMessage,
  getRequestFieldErrors,
  type FieldErrors,
} from "@/lib/client/api";
import { useAuthSession } from "@/modules/auth/components/AuthSessionProvider";

const INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

const TEXTAREA_CLASS_NAME =
  "mt-2 min-h-[7rem] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

function Toggle({
  checked,
  disabled = false,
  onChange,
}: Readonly<{
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onChange(!checked);
        }
      }}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
        checked ? "bg-blue-500" : "bg-slate-300"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function formatDateUtc(iso: string | null): string {
  if (iso === null || iso === "") {
    return "—";
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

function isRateSetActive(row: RateSetApiRow): boolean {
  return row.deactivated_at === null;
}

function ActiveIndicator({ active }: Readonly<{ active: boolean }>) {
  if (!active) {
    return (
      <span
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-500"
        title="Inactive"
        aria-label="Inactive"
        role="img"
      >
        <span className="text-[15px] font-light leading-none" aria-hidden>
          ×
        </span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm"
      title="Active"
      aria-label="Active"
      role="img"
    >
      <svg
        aria-hidden
        className="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.75"
      >
        <path
          d="M5 12l5 5L20 7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

const PERIOD_DATE_INPUT_CLASS =
  "mt-0 w-full min-w-[8.5rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500";

const RATE_SET_GRID_PRICE_KEYS = ["M", "N", "O", "P", "Q", "R", "S", "T", "U", "V"] as const;
const IMPORT_GRID_MIN_WIDTH_CLASS_BY_KEY: Record<string, string> = {
  A: "min-w-[12rem]",
  B: "min-w-[22rem]",
  F: "min-w-[10rem]",
  H: "min-w-[18rem]",
  I: "min-w-[5rem]",
  J: "min-w-[6rem]",
  K: "min-w-[8rem]",
  L: "min-w-[8rem]",
  M: "min-w-[7rem]",
  N: "min-w-[7rem]",
  O: "min-w-[7rem]",
  P: "min-w-[7rem]",
  Q: "min-w-[7rem]",
  R: "min-w-[7rem]",
  S: "min-w-[7rem]",
  T: "min-w-[7rem]",
  U: "min-w-[8rem]",
  V: "min-w-[8rem]",
  W: "min-w-[14rem]",
  X: "min-w-[9rem]",
  Y: "min-w-[12rem]",
  Z: "min-w-[11rem]",
  AA: "min-w-[11rem]",
  AB: "min-w-[12rem]",
};

type ActiveFilterValue = "all" | "active" | "inactive";

type AddDrawerFieldKey =
  | "name"
  | "description"
  | "start_date"
  | "end_date"
  | "active"
  | "form";

type GridPaginationItem = number | "ellipsis";
type UnitPriceRangeValue = { min: number; max: number } | null;

function formatDateInputValue(iso: string | null): string {
  return iso?.slice(0, 10) ?? "";
}

function parseGridDateValue(iso: string | null): string {
  return iso?.slice(0, 10) ?? "";
}

function getGridUnitPrices(row: RateSetImportGridRow): number[] {
  const prices: number[] = [];

  for (const key of RATE_SET_GRID_PRICE_KEYS) {
    const value = row[key];

    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number.parseFloat(value);

      if (Number.isFinite(parsed)) {
        prices.push(parsed);
      }
    }
  }

  return prices;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatUnitPriceDisplay(value: number | null): string {
  return value === null ? "0.00" : value.toFixed(2);
}

function matchesImportGridRowFilters(
  row: RateSetImportGridRow,
  filters: {
    categoryFilter: string;
    itemFilter: string;
    typeFilter: string;
    gridStartDate: string;
    gridEndDate: string;
    unitPriceMin: number | null;
    unitPriceMax: number | null;
    ignoreCategory?: boolean;
    ignoreItem?: boolean;
  },
): boolean {
  if (
    !filters.ignoreCategory &&
    filters.categoryFilter !== "all" &&
    row.F !== filters.categoryFilter
  ) {
    return false;
  }

  if (
    !filters.ignoreItem &&
    filters.itemFilter !== "all" &&
    row.A !== filters.itemFilter
  ) {
    return false;
  }

  if (filters.typeFilter !== "all" && row.AB !== filters.typeFilter) {
    return false;
  }

  const rowStart = parseGridDateValue(typeof row.K === "string" ? row.K : null);
  const rowEnd = parseGridDateValue(typeof row.L === "string" ? row.L : null);

  if (filters.gridStartDate !== "" && rowEnd !== "" && rowEnd < filters.gridStartDate) {
    return false;
  }

  if (filters.gridEndDate !== "" && rowStart !== "" && rowStart > filters.gridEndDate) {
    return false;
  }

  if (filters.unitPriceMin !== null || filters.unitPriceMax !== null) {
    const prices = getGridUnitPrices(row);

    if (prices.length === 0) {
      return false;
    }

    const matchesRange = prices.some((price) => {
      if (filters.unitPriceMin !== null && price < filters.unitPriceMin) {
        return false;
      }

      if (filters.unitPriceMax !== null && price > filters.unitPriceMax) {
        return false;
      }

      return true;
    });

    if (!matchesRange) {
      return false;
    }
  }

  return true;
}

function normalizeUnitPriceRange(
  nextValue: { min: number; max: number },
  bounds: { min: number; max: number },
): UnitPriceRangeValue {
  const min = clampNumber(nextValue.min, bounds.min, bounds.max);
  const max = clampNumber(nextValue.max, min, bounds.max);

  if (
    Math.abs(min - bounds.min) < 0.0001 &&
    Math.abs(max - bounds.max) < 0.0001
  ) {
    return null;
  }

  return { min, max };
}

function buildPaginationItems(
  totalPages: number,
  currentPage: number,
): GridPaginationItem[] {
  if (totalPages <= 0) {
    return [];
  }

  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: GridPaginationItem[] = [1];

  if (currentPage > 3) {
    items.push("ellipsis");
  }

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  for (let page = start; page <= end; page++) {
    items.push(page);
  }

  if (currentPage < totalPages - 2) {
    items.push("ellipsis");
  }

  items.push(totalPages);
  return items;
}

function GridBooleanBadge({ value }: Readonly<{ value: boolean }>) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold ${
        value
          ? "border-blue-200 bg-blue-50 text-blue-600"
          : "border-slate-200 bg-white text-slate-400"
      }`}
      aria-label={value ? "Yes" : "No"}
      title={value ? "Yes" : "No"}
    >
      {value ? "✓" : "×"}
    </span>
  );
}

function UnitPriceRangeSlider({
  bounds,
  value,
  onChange,
  disabled = false,
}: Readonly<{
  bounds: { min: number; max: number } | null;
  value: UnitPriceRangeValue;
  onChange: (nextValue: UnitPriceRangeValue) => void;
  disabled?: boolean;
}>) {
  const displayMin = value?.min ?? bounds?.min ?? null;
  const displayMax = value?.max ?? bounds?.max ?? null;

  if (bounds === null) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input
          readOnly
          value={formatUnitPriceDisplay(displayMin)}
          className="w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 outline-none"
          aria-label="Minimum unit price"
        />
        <div className="flex min-w-40 flex-1 items-center">
          <div className="h-1 w-full rounded-full bg-slate-200" />
        </div>
        <input
          readOnly
          value={formatUnitPriceDisplay(displayMax)}
          className="w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 outline-none"
          aria-label="Maximum unit price"
        />
      </div>
    );
  }

  const minValue = clampNumber(value?.min ?? bounds.min, bounds.min, bounds.max);
  const maxValue = clampNumber(value?.max ?? bounds.max, minValue, bounds.max);
  const span = bounds.max - bounds.min;
  const startPercent = span === 0 ? 0 : ((minValue - bounds.min) / span) * 100;
  const endPercent = span === 0 ? 100 : ((maxValue - bounds.min) / span) * 100;

  return (
    <div
      className={`mt-2 flex flex-wrap items-center gap-3${disabled ? " opacity-60" : ""}`}
    >
      <input
        readOnly
        value={formatUnitPriceDisplay(minValue)}
        className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
        aria-label="Minimum unit price"
      />
      <div className="relative min-w-40 flex-1 py-3">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-200" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-blue-400"
          style={{
            left: `${startPercent}%`,
            width: `${Math.max(endPercent - startPercent, 0)}%`,
          }}
        />
        <input
          type="range"
          min={bounds.min}
          max={bounds.max}
          step="0.01"
          value={minValue}
          disabled={disabled}
          onChange={(event) => {
            const nextMin = Number.parseFloat(event.target.value);
            onChange(
              normalizeUnitPriceRange({ min: nextMin, max: maxValue }, bounds),
            );
          }}
          className="pointer-events-none absolute inset-0 z-10 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-blue-400 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-blue-400 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-sm"
          aria-label="Adjust minimum unit price"
        />
        <input
          type="range"
          min={bounds.min}
          max={bounds.max}
          step="0.01"
          value={maxValue}
          disabled={disabled}
          onChange={(event) => {
            const nextMax = Number.parseFloat(event.target.value);
            onChange(
              normalizeUnitPriceRange({ min: minValue, max: nextMax }, bounds),
            );
          }}
          className="pointer-events-none absolute inset-0 z-20 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-blue-400 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-blue-400 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-sm"
          aria-label="Adjust maximum unit price"
        />
      </div>
      <input
        readOnly
        value={formatUnitPriceDisplay(maxValue)}
        className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
        aria-label="Maximum unit price"
      />
    </div>
  );
}

function formatGridCellValue(
  column: RateSetImportGridColumn,
  value: RateSetImportGridCellValue,
) {
  if (typeof value === "boolean") {
    return <GridBooleanBadge value={value} />;
  }

  if (value === null || value === "") {
    return "—";
  }

  if (column.key === "K" || column.key === "L") {
    return formatDateUtc(String(value));
  }

  return String(value);
}

function buildRateSetFormData(input: {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  active: boolean;
  file?: File;
}): FormData {
  const body = new FormData();

  body.set("name", input.name.trim());
  body.set("description", input.description.trim());
  body.set("start_date", input.startDate);
  body.set("end_date", input.endDate);
  body.set("active", input.active ? "true" : "false");

  if (input.file) {
    body.set("file", input.file);
  }

  return body;
}

function toUtcMidnightIso(ymd: string): string {
  return new Date(`${ymd}T00:00:00.000Z`).toISOString();
}

function RateSetDateCheckMessages({
  overlapLabels,
  gapLabels,
}: Readonly<{
  overlapLabels: string[];
  gapLabels: string[];
}>) {
  if (overlapLabels.length === 0 && gapLabels.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2 text-sm leading-6">
      {overlapLabels.length > 0 ? (
        <p className="text-rose-500">
          Date range overlaps with an existing Rate Set:
          <br />
          {overlapLabels.join(", ")}
        </p>
      ) : null}
      {gapLabels.length > 0 ? (
        <p className="text-amber-500">
          Warning: this date range leaves a gap with adjacent Rate Sets:
          <br />
          {gapLabels.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function getImportGridCellClass(
  columnKey: string,
  variant: "head" | "body",
): string {
  const widthClass = IMPORT_GRID_MIN_WIDTH_CLASS_BY_KEY[columnKey] ?? "min-w-[7rem]";
  return variant === "head"
    ? `px-3 py-3 font-semibold whitespace-nowrap ${widthClass}`
    : `px-3 py-4 text-slate-700 whitespace-nowrap ${widthClass}`;
}

function RateSetEditDialog({
  rateSetId,
  readOnly,
  onClose,
  onSaved,
}: Readonly<{
  rateSetId: number | null;
  /** When true (no rate_sets.write): view metadata and grid only; no save or edits. */
  readOnly: boolean;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}>) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<AddDrawerFieldKey>>(
    {},
  );
  const [editDateOverlapLabels, setEditDateOverlapLabels] = useState<string[]>([]);
  const [editDateGapLabels, setEditDateGapLabels] = useState<string[]>([]);
  const [editDateMessageTarget, setEditDateMessageTarget] = useState<
    "start" | "end" | null
  >(null);
  const [isCheckingEditDates, setIsCheckingEditDates] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [excelLabel, setExcelLabel] = useState("");
  const [hasImportedRates, setHasImportedRates] = useState(false);
  const [importGridData, setImportGridData] = useState<RateSetImportGridData | null>(
    null,
  );
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [itemFilter, setItemFilter] = useState("all");
  const [gridStartDate, setGridStartDate] = useState("");
  const [gridEndDate, setGridEndDate] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [unitPriceRange, setUnitPriceRange] = useState<UnitPriceRangeValue>(null);
  const [gridPageSize, setGridPageSize] = useState(20);
  const [gridCurrentPage, setGridCurrentPage] = useState(1);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const editDateCheckRequestIdRef = useRef(0);
  const disableMutation = isLoading || readOnly;

  const resetGridFilters = useCallback(() => {
    setCategoryFilter("all");
    setItemFilter("all");
    setGridStartDate("");
    setGridEndDate("");
    setTypeFilter("all");
    setUnitPriceRange(null);
    setGridPageSize(20);
    setGridCurrentPage(1);
  }, []);

  const loadDrawerData = useCallback(async () => {
    if (rateSetId === null) {
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    setFieldErrors({});
    setEditDateOverlapLabels([]);
    setEditDateGapLabels([]);
    setEditDateMessageTarget(null);
    setIsCheckingEditDates(false);
    resetGridFilters();
    setExcelLabel("");

    if (excelInputRef.current) {
      excelInputRef.current.value = "";
    }

    try {
      const detail = await fetchApiData<RateSetApiRow>(
        `/api/rate-sets/${rateSetId}`,
      );
      setFormName(detail.name);
      setFormDescription(detail.description ?? "");
      setFormStartDate(formatDateInputValue(detail.start_date));
      setFormEndDate(formatDateInputValue(detail.end_date));
      setFormActive(detail.deactivated_at === null);

      let hasImportedRates = false;
      try {
        const imported = await fetchApiData<RateSetImportedState>(
          `/api/rate-sets/${rateSetId}/imported`,
          undefined,
          { redirectOnForbidden: false },
        );
        hasImportedRates = imported.hasImportedRates;
      } catch {
        hasImportedRates = false;
      }
      setHasImportedRates(hasImportedRates);

      if (hasImportedRates) {
        try {
          const grid = await fetchApiData<RateSetImportGridData>(
            `/api/rate-sets/${rateSetId}/import-grid`,
            undefined,
            { redirectOnForbidden: false },
          );
          setImportGridData(grid);
        } catch {
          setImportGridData(null);
        }
      } else {
        setImportGridData(null);
      }
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to load rate set."));
    } finally {
      setIsLoading(false);
    }
  }, [rateSetId, resetGridFilters]);

  useEffect(() => {
    if (rateSetId === null) {
      editDateCheckRequestIdRef.current += 1;
      setEditDateOverlapLabels([]);
      setEditDateGapLabels([]);
      setEditDateMessageTarget(null);
      setIsCheckingEditDates(false);
      return;
    }

    void loadDrawerData();
  }, [rateSetId, loadDrawerData]);

  useEffect(() => {
    if (rateSetId === null || isLoading) {
      editDateCheckRequestIdRef.current += 1;
      setEditDateOverlapLabels([]);
      setEditDateGapLabels([]);
      setEditDateMessageTarget(null);
      setIsCheckingEditDates(false);
      return;
    }

    if (formStartDate === "" || (formEndDate !== "" && formEndDate < formStartDate)) {
      editDateCheckRequestIdRef.current += 1;
      setEditDateOverlapLabels([]);
      setEditDateGapLabels([]);
      setEditDateMessageTarget(null);
      setIsCheckingEditDates(false);
      return;
    }

    const messageTarget = formEndDate === "" ? "start" : "end";
    const requestId = editDateCheckRequestIdRef.current + 1;
    editDateCheckRequestIdRef.current = requestId;
    setEditDateMessageTarget(messageTarget);

    const timeoutId = globalThis.setTimeout(() => {
      void (async () => {
        setIsCheckingEditDates(true);

        try {
          const params = new URLSearchParams({
            start_date: toUtcMidnightIso(formStartDate),
            exclude_id: String(rateSetId),
          });

          if (formEndDate !== "") {
            params.set("end_date", toUtcMidnightIso(formEndDate));
          }

          const [overlapCheck, gapCheck] = await Promise.all([
            fetchRateSetDateOverlapCheck(params),
            fetchRateSetDateGapCheck(params),
          ]);

          if (editDateCheckRequestIdRef.current !== requestId) {
            return;
          }

          setEditDateOverlapLabels(overlapCheck.overlaps);
          setEditDateGapLabels(gapCheck.adjacent);
          setEditDateMessageTarget(messageTarget);
        } catch {
          if (editDateCheckRequestIdRef.current !== requestId) {
            return;
          }

          setEditDateOverlapLabels([]);
          setEditDateGapLabels([]);
          setEditDateMessageTarget(messageTarget);
        } finally {
          if (editDateCheckRequestIdRef.current === requestId) {
            setIsCheckingEditDates(false);
          }
        }
      })();
    }, 200);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [rateSetId, isLoading, formStartDate, formEndDate]);

  const typeOptions = useMemo(() => {
    const rows = importGridData?.rows ?? [];
    const unique = new Map<string, string>();

    for (const row of rows) {
      const value = typeof row.AB === "string" ? row.AB : "";

      if (value !== "" && !unique.has(value)) {
        unique.set(value, value);
      }
    }

    return [...unique.entries()].map(([value, label]) => ({ value, label }));
  }, [importGridData]);

  const unitPriceBounds = useMemo(() => {
    const rows = importGridData?.rows ?? [];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const row of rows) {
      for (const price of getGridUnitPrices(row)) {
        min = Math.min(min, price);
        max = Math.max(max, price);
      }
    }

    return Number.isFinite(min) && Number.isFinite(max)
      ? { min, max }
      : null;
  }, [importGridData]);

  const unitPriceFilterMin = unitPriceRange?.min ?? null;
  const unitPriceFilterMax = unitPriceRange?.max ?? null;
  const importGridRows = useMemo(() => importGridData?.rows ?? [], [importGridData]);

  const categoryOptions = useMemo(() => {
    const unique = new Map<string, string>();

    for (const row of importGridRows) {
      if (
        !matchesImportGridRowFilters(row, {
          categoryFilter,
          itemFilter,
          typeFilter,
          gridStartDate,
          gridEndDate,
          unitPriceMin: unitPriceFilterMin,
          unitPriceMax: unitPriceFilterMax,
          ignoreCategory: true,
        })
      ) {
        continue;
      }

      const number = typeof row.F === "string" ? row.F : "";
      const name = typeof row.H === "string" ? row.H : "";

      if (number !== "" && !unique.has(number)) {
        unique.set(number, `${number} - ${name}`);
      }
    }

    return [...unique.entries()].map(([value, label]) => ({ value, label }));
  }, [
    importGridRows,
    categoryFilter,
    itemFilter,
    typeFilter,
    gridStartDate,
    gridEndDate,
    unitPriceFilterMin,
    unitPriceFilterMax,
  ]);

  const itemOptions = useMemo(() => {
    const unique = new Map<string, string>();

    for (const row of importGridRows) {
      if (
        !matchesImportGridRowFilters(row, {
          categoryFilter,
          itemFilter,
          typeFilter,
          gridStartDate,
          gridEndDate,
          unitPriceMin: unitPriceFilterMin,
          unitPriceMax: unitPriceFilterMax,
          ignoreItem: true,
        })
      ) {
        continue;
      }

      const value = typeof row.A === "string" ? row.A : "";
      const label = typeof row.B === "string" ? row.B : "";

      if (value !== "" && !unique.has(value)) {
        unique.set(value, label === "" ? value : label);
      }
    }

    return [...unique.entries()].map(([value, label]) => ({ value, label }));
  }, [
    importGridRows,
    categoryFilter,
    itemFilter,
    typeFilter,
    gridStartDate,
    gridEndDate,
    unitPriceFilterMin,
    unitPriceFilterMax,
  ]);

  const filteredGridRows = useMemo(() => {
    return importGridRows.filter((row) =>
      matchesImportGridRowFilters(row, {
        categoryFilter,
        itemFilter,
        typeFilter,
        gridStartDate,
        gridEndDate,
        unitPriceMin: unitPriceFilterMin,
        unitPriceMax: unitPriceFilterMax,
      }),
    );
  }, [
    categoryFilter,
    itemFilter,
    typeFilter,
    gridStartDate,
    gridEndDate,
    unitPriceFilterMin,
    unitPriceFilterMax,
    importGridRows,
  ]);

  useEffect(() => {
    setGridCurrentPage(1);
  }, [
    categoryFilter,
    itemFilter,
    typeFilter,
    gridStartDate,
    gridEndDate,
    unitPriceFilterMin,
    unitPriceFilterMax,
    gridPageSize,
  ]);

  useEffect(() => {
    if (categoryFilter === "all") {
      return;
    }

    const stillExists = categoryOptions.some(
      (category) => category.value === categoryFilter,
    );

    if (!stillExists) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, categoryOptions]);

  useEffect(() => {
    if (itemFilter === "all") {
      return;
    }

    const stillExists = itemOptions.some((item) => item.value === itemFilter);

    if (!stillExists) {
      setItemFilter("all");
    }
  }, [itemFilter, itemOptions]);

  if (rateSetId === null) {
    return null;
  }

  const gridTotalPages = Math.max(
    1,
    Math.ceil(filteredGridRows.length / gridPageSize),
  );
  const safeGridPage = Math.min(gridCurrentPage, gridTotalPages);
  const pagedGridRows = filteredGridRows.slice(
    (safeGridPage - 1) * gridPageSize,
    safeGridPage * gridPageSize,
  );

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rateSetId === null || readOnly) {
      return;
    }

    setIsSubmitting(true);
    setLoadError(null);
    setFieldErrors({});

    try {
      if (editDateOverlapLabels.length > 0) {
        return;
      }

      await fetchApiData<RateSetApiRow>(`/api/rate-sets/${rateSetId}`, {
        method: "PATCH",
        body: buildRateSetFormData({
          name: formName,
          description: formDescription,
          startDate: formStartDate,
          endDate: formEndDate,
          active: formActive,
          file: excelInputRef.current?.files?.[0],
        }),
      });

      const message =
        excelInputRef.current?.files?.[0] !== undefined
          ? "Rate set updated and workbook imported successfully."
          : "Rate set updated successfully.";

      await onSaved(message);
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldErrors(getRequestFieldErrors<AddDrawerFieldKey>(error));
      }

      setLoadError(getRequestErrorMessage(error, "Failed to update rate set."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-80 overflow-y-auto bg-slate-900/60 p-4">
      <div className="mx-auto flex min-h-full max-w-[min(96vw,84rem)] items-start justify-center">
        <div
          className="w-full rounded-2xl border border-slate-200 bg-white shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-rate-set-title"
        >
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <span className="block text-xl leading-none" aria-hidden>
                  ×
                </span>
              </button>
              <h3
                id="edit-rate-set-title"
                className="text-xl font-semibold tracking-tight text-slate-900"
              >
                {readOnly ? "View Rate Set" : "Edit Rate Set"}
              </h3>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              {readOnly ? null : (
                <button
                  type="submit"
                  form="edit-rate-set-form"
                  disabled={
                    isLoading ||
                    isSubmitting ||
                    isCheckingEditDates ||
                    editDateOverlapLabels.length > 0
                  }
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
                >
                  {isSubmitting
                    ? "Saving..."
                    : isCheckingEditDates
                      ? "Checking..."
                      : "Save"}
                </button>
              )}
            </div>
          </div>

          <form
            id="edit-rate-set-form"
            onSubmit={(event) => void handleSubmit(event)}
            className="px-5 py-4"
          >
            {loadError ? (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {loadError}
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[1.1fr_1.5fr_180px_180px_120px]">
              <label className="text-sm font-medium text-slate-600">
                <span className="text-rose-600">*</span> Name
                <input
                  value={formName}
                  onChange={(event) => {
                    setFormName(event.target.value);
                    setFieldErrors((previous) => ({ ...previous, name: undefined }));
                  }}
                  className={INPUT_CLASS_NAME}
                  disabled={disableMutation}
                />
              </label>

              <label className="text-sm font-medium text-slate-600">
                Description
                <input
                  value={formDescription}
                  onChange={(event) => {
                    setFormDescription(event.target.value);
                    setFieldErrors((previous) => ({
                      ...previous,
                      description: undefined,
                    }));
                  }}
                  placeholder="e.g., NDIS Pricing Arrangements and Price Limits effective from 24 November 2025"
                  className={INPUT_CLASS_NAME}
                  disabled={disableMutation}
                />
              </label>

              <label className="text-sm font-medium text-slate-600">
                <span className="text-rose-600">*</span> Start Date
                <input
                  type="date"
                  value={formStartDate}
                  onChange={(event) => {
                    setFormStartDate(event.target.value);
                    setLoadError(null);
                    setFieldErrors((previous) => ({
                      ...previous,
                      start_date: undefined,
                    }));
                  }}
                  className={INPUT_CLASS_NAME}
                  disabled={disableMutation}
                />
                {editDateMessageTarget === "start" ? (
                  <RateSetDateCheckMessages
                    overlapLabels={editDateOverlapLabels}
                    gapLabels={editDateGapLabels}
                  />
                ) : null}
              </label>

              <label className="text-sm font-medium text-slate-600">
                End Date
                <input
                  type="date"
                  value={formEndDate}
                  min={formStartDate || undefined}
                  onChange={(event) => {
                    setFormEndDate(event.target.value);
                    setLoadError(null);
                    setFieldErrors((previous) => ({
                      ...previous,
                      end_date: undefined,
                    }));
                  }}
                  className={INPUT_CLASS_NAME}
                  disabled={disableMutation}
                />
                {editDateMessageTarget === "end" ? (
                  <RateSetDateCheckMessages
                    overlapLabels={editDateOverlapLabels}
                    gapLabels={editDateGapLabels}
                  />
                ) : null}
              </label>

              <div className="text-sm font-medium text-slate-600">
                Active
                <div className="mt-4 flex h-[42px] items-center">
                  <Toggle
                    checked={formActive}
                    disabled={disableMutation}
                    onChange={setFormActive}
                  />
                </div>
              </div>
            </div>

            {(fieldErrors.name ||
              fieldErrors.description ||
              fieldErrors.start_date ||
              fieldErrors.end_date ||
              fieldErrors.active) && (
              <div className="mt-2 grid gap-2 text-xs text-rose-600 lg:grid-cols-[1.1fr_1.5fr_180px_180px_120px]">
                <div>{fieldErrors.name ?? ""}</div>
                <div>{fieldErrors.description ?? ""}</div>
                <div>{fieldErrors.start_date ?? ""}</div>
                <div>{fieldErrors.end_date ?? ""}</div>
                <div>{fieldErrors.active ?? ""}</div>
              </div>
            )}

            <div className="mt-6">
              <p className="text-sm font-medium text-slate-600">
                Upload NDIS Pricing Arrangements and Price Limits Excel
              </p>
              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="sr-only"
                id="edit-rate-set-excel-upload"
                disabled={disableMutation}
                onChange={(event) => setExcelLabel(event.target.files?.[0]?.name ?? "")}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => excelInputRef.current?.click()}
                  disabled={disableMutation}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select File
                </button>
                {excelLabel !== "" ? (
                  <span className="text-xs text-slate-500">{excelLabel}</span>
                ) : null}
              </div>
            </div>

            {hasImportedRates ? (
              <>
                <div className="mt-8 grid gap-4 xl:grid-cols-[1.1fr_1.1fr_180px_180px_1fr]">
                  <div>
                    <label
                      className="text-sm font-medium text-slate-500"
                      htmlFor="editRateSetCategory"
                    >
                      Support Category
                    </label>
                    <div className="mt-2">
                      <select
                        id="editRateSetCategory"
                        value={categoryFilter}
                        onChange={(event) => setCategoryFilter(event.target.value)}
                        disabled={isLoading}
                        className={INPUT_CLASS_NAME}
                      >
                        <option value="all">All Support Categories</option>
                        {categoryOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label
                      className="text-sm font-medium text-slate-500"
                      htmlFor="editRateSetItem"
                    >
                      Support Item
                    </label>
                    <div className="mt-2">
                      <select
                        id="editRateSetItem"
                        value={itemFilter}
                        onChange={(event) => setItemFilter(event.target.value)}
                        disabled={isLoading}
                        className={INPUT_CLASS_NAME}
                      >
                        <option value="all">All Support Items</option>
                        {itemOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <label className="text-sm font-medium text-slate-500">
                    Start Date
                    <input
                      type="date"
                      value={gridStartDate}
                      onChange={(event) => setGridStartDate(event.target.value)}
                      disabled={isLoading}
                      className={INPUT_CLASS_NAME}
                    />
                  </label>

                  <label className="text-sm font-medium text-slate-500">
                    End Date
                    <input
                      type="date"
                      value={gridEndDate}
                      onChange={(event) => setGridEndDate(event.target.value)}
                      disabled={isLoading}
                      className={INPUT_CLASS_NAME}
                    />
                  </label>

                  <div>
                    <label
                      className="text-sm font-medium text-slate-500"
                      htmlFor="editRateSetType"
                    >
                      Type
                    </label>
                    <select
                      id="editRateSetType"
                      value={typeFilter}
                      onChange={(event) => setTypeFilter(event.target.value)}
                      disabled={isLoading}
                      className={INPUT_CLASS_NAME}
                    >
                      <option value="all">All Types</option>
                      {typeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <span className="text-sm font-medium text-slate-500">Unit Price</span>
                  <UnitPriceRangeSlider
                    bounds={unitPriceBounds}
                    value={unitPriceRange}
                    onChange={setUnitPriceRange}
                    disabled={isLoading}
                  />
                </div>

                <p className="mt-4 text-xs text-slate-400">
                  Scroll horizontally to view all imported fields.
                </p>

                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-max text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        {(importGridData?.columns ?? []).map((column) => (
                          <th
                            key={column.key}
                            className={getImportGridCellClass(column.key, "head")}
                          >
                            {column.title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {!isLoading && pagedGridRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={importGridData?.columns.length ?? 1}
                            className="px-3 py-10 text-center text-sm text-slate-500"
                          >
                            No imported rows match the current filters.
                          </td>
                        </tr>
                      ) : null}

                      {pagedGridRows.map((row) => (
                        <tr key={row.id} className="transition hover:bg-slate-50">
                          {(importGridData?.columns ?? []).map((column) => (
                            <td
                              key={`${row.id}-${column.key}`}
                              className={getImportGridCellClass(column.key, "body")}
                            >
                              {formatGridCellValue(column, row[column.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <nav
                    className="flex flex-wrap items-center gap-1"
                    aria-label="Imported rate rows pagination"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setGridCurrentPage((page) => Math.max(1, page - 1))
                      }
                      disabled={safeGridPage <= 1}
                      className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 px-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {"<"}
                    </button>

                    {buildPaginationItems(gridTotalPages, safeGridPage).map(
                      (item, index, array) =>
                        item === "ellipsis" ? (
                          <span
                            key={`grid-ellipsis-${String(array[index - 1])}-${String(array[index + 1])}`}
                            className="inline-flex min-w-8 items-center justify-center px-1 text-sm text-slate-400"
                          >
                            …
                          </span>
                        ) : (
                          <button
                            key={item}
                            type="button"
                            onClick={() => setGridCurrentPage(item)}
                            className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border px-3 py-1 text-sm transition ${
                              item === safeGridPage
                                ? "border-[#1890ff] bg-white font-semibold text-[#1890ff]"
                                : "border-transparent text-slate-900 hover:border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            {item}
                          </button>
                        ),
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setGridCurrentPage((page) =>
                          Math.min(gridTotalPages, page + 1),
                        )
                      }
                      disabled={safeGridPage >= gridTotalPages}
                      className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 px-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {">"}
                    </button>
                  </nav>

                  <select
                    value={gridPageSize}
                    onChange={(event) => setGridPageSize(Number(event.target.value))}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-blue-500"
                  >
                    <option value={10}>10 / page</option>
                    <option value={20}>20 / page</option>
                    <option value={50}>50 / page</option>
                  </select>
                </div>
              </>
            ) : (
              <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                No imported rates yet for this rate set. Select an NDIS workbook and
                save to import pricing data.
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

export function RateSetsManager() {
  const { session } = useAuthSession();
  const canWriteRateSets = Boolean(
    session?.user.permissions.includes("rate_sets.write"),
  );
  const canDeleteRateSets = Boolean(
    session?.user.permissions.includes("rate_sets.delete"),
  );

  const [rows, setRows] = useState<RateSetApiRow[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [periodStartInput, setPeriodStartInput] = useState("");
  const [periodEndInput, setPeriodEndInput] = useState("");
  const [periodDebounced, setPeriodDebounced] = useState({
    start: "",
    end: "",
  });
  const [activeFilter, setActiveFilter] = useState<ActiveFilterValue>("all");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [editRateSetId, setEditRateSetId] = useState<number | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [addDrawerError, setAddDrawerError] = useState<string | null>(null);
  const [addFieldErrors, setAddFieldErrors] =
    useState<FieldErrors<AddDrawerFieldKey>>({});
  const [addDateOverlapLabels, setAddDateOverlapLabels] = useState<string[]>([]);
  const [addDateGapLabels, setAddDateGapLabels] = useState<string[]>([]);
  const [addDateMessageTarget, setAddDateMessageTarget] = useState<
    "start" | "end" | null
  >(null);
  const [isCheckingAddDates, setIsCheckingAddDates] = useState(false);
  const [excelLabel, setExcelLabel] = useState("");
  const excelInputRef = useRef<HTMLInputElement>(null);
  const addDateCheckRequestIdRef = useRef(0);

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => {
      setSearchApplied(searchInput.trim());
    }, 250);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => {
      setPeriodDebounced({
        start: periodStartInput,
        end: periodEndInput,
      });
    }, 250);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [periodStartInput, periodEndInput]);

  const periodFilterError = useMemo(() => {
    const s = periodDebounced.start;
    const e = periodDebounced.end;

    if (s !== "" && e !== "" && s > e) {
      return "Period end date must be on or after the start date.";
    }

    return null;
  }, [periodDebounced]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchApplied, periodDebounced.start, periodDebounced.end, activeFilter, pageSize]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      setToastMessage(null);
    }, 4000);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [toastMessage]);

  useEffect(() => {
    if (!addDrawerOpen) {
      addDateCheckRequestIdRef.current += 1;
      setAddDateOverlapLabels([]);
      setAddDateGapLabels([]);
      setAddDateMessageTarget(null);
      setIsCheckingAddDates(false);
      return;
    }

    if (formStartDate === "" || (formEndDate !== "" && formEndDate < formStartDate)) {
      addDateCheckRequestIdRef.current += 1;
      setAddDateOverlapLabels([]);
      setAddDateGapLabels([]);
      setAddDateMessageTarget(null);
      setIsCheckingAddDates(false);
      return;
    }

    const messageTarget = formEndDate === "" ? "start" : "end";
    const requestId = addDateCheckRequestIdRef.current + 1;
    addDateCheckRequestIdRef.current = requestId;
    setAddDateMessageTarget(messageTarget);

    const timeoutId = globalThis.setTimeout(() => {
      void (async () => {
        setIsCheckingAddDates(true);

        try {
          const params = new URLSearchParams({
            start_date: toUtcMidnightIso(formStartDate),
          });

          if (formEndDate !== "") {
            params.set("end_date", toUtcMidnightIso(formEndDate));
          }

          const [overlapCheck, gapCheck] = await Promise.all([
            fetchRateSetDateOverlapCheck(params),
            fetchRateSetDateGapCheck(params),
          ]);

          if (addDateCheckRequestIdRef.current !== requestId) {
            return;
          }

          setAddDateOverlapLabels(overlapCheck.overlaps);
          setAddDateGapLabels(gapCheck.adjacent);
          setAddDateMessageTarget(messageTarget);
        } catch {
          if (addDateCheckRequestIdRef.current !== requestId) {
            return;
          }

          setAddDateOverlapLabels([]);
          setAddDateGapLabels([]);
          setAddDateMessageTarget(messageTarget);
        } finally {
          if (addDateCheckRequestIdRef.current === requestId) {
            setIsCheckingAddDates(false);
          }
        }
      })();
    }, 200);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [addDrawerOpen, formStartDate, formEndDate]);

  const loadRateSets = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String((currentPage - 1) * pageSize));

      if (searchApplied !== "") {
        params.set("search", searchApplied);
      }

      const ps = periodDebounced.start;
      const pe = periodDebounced.end;

      if (ps !== "" && pe !== "" && ps <= pe) {
        params.set("period_start", ps);
        params.set("period_end", pe);
      }

      if (activeFilter !== "all") {
        params.set("active", activeFilter);
      }

      const endpoint = `/api/rate-sets?${params.toString()}`;
      const { data, pagination } =
        await fetchApiListWithPagination<RateSetApiRow>(endpoint);

      setRows(data);
      setListTotal(pagination.total);

      const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize));
      setCurrentPage((page) => Math.min(page, totalPages));
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to load rate sets."));
    } finally {
      setIsLoading(false);
    }
  }, [
    searchApplied,
    periodDebounced.start,
    periodDebounced.end,
    activeFilter,
    pageSize,
    currentPage,
  ]);

  useEffect(() => {
    void loadRateSets();
  }, [loadRateSets]);

  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  function openAddDrawer() {
    if (!canWriteRateSets) {
      return;
    }
    setFormName("");
    setFormDescription("");
    setFormStartDate("");
    setFormEndDate("");
    setFormActive(true);
    setAddDrawerError(null);
    setAddFieldErrors({});
    setAddDateOverlapLabels([]);
    setAddDateGapLabels([]);
    setAddDateMessageTarget(null);
    setIsCheckingAddDates(false);
    setExcelLabel("");
    if (excelInputRef.current) {
      excelInputRef.current.value = "";
    }
    setAddDrawerOpen(true);
  }

  function closeAddDrawer() {
    setAddDrawerOpen(false);
    setAddSubmitting(false);
    setAddDrawerError(null);
    setAddFieldErrors({});
    setAddDateOverlapLabels([]);
    setAddDateGapLabels([]);
    setAddDateMessageTarget(null);
    setIsCheckingAddDates(false);
  }

  async function submitAddRateSet(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWriteRateSets) {
      return;
    }
    setAddDrawerError(null);
    setAddFieldErrors({});

    const excelFile = excelInputRef.current?.files?.[0];

    setAddSubmitting(true);

    try {
      if (addDateOverlapLabels.length > 0) {
        return;
      }

      await fetchApiData<RateSetApiRow>("/api/rate-sets", {
        method: "POST",
        body: buildRateSetFormData({
          name: formName,
          description: formDescription,
          startDate: formStartDate,
          endDate: formEndDate,
          active: formActive,
          file: excelFile,
        }),
      });
      setToastMessage(
        excelFile
          ? "Rate set created and workbook imported successfully."
          : "Rate set created successfully.",
      );

      closeAddDrawer();
      await loadRateSets();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setAddFieldErrors(getRequestFieldErrors<AddDrawerFieldKey>(error));
      }

      setAddDrawerError(
        getRequestErrorMessage(error, "Failed to create rate set."),
      );
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleDelete(row: RateSetApiRow) {
    const ok = globalThis.confirm(
      `Delete rate set “${row.name}”? This cannot be undone.`,
    );

    if (!ok) {
      return;
    }

    setDeletingId(row.id);
    setLoadError(null);

    try {
      await fetchApiData(`/api/rate-sets/${row.id}`, { method: "DELETE" });
      setToastMessage("Rate set removed successfully.");
      await loadRateSets();
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to delete rate set."));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed top-6 left-1/2 z-200 flex max-w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 justify-center px-4"
        >
          <div className="pointer-events-auto rounded-xl border border-white/25 bg-[rgb(18,185,129)] px-5 py-3 text-sm font-medium text-white shadow-lg">
            {toastMessage}
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
            Rate Sets
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage effective date windows and metadata for each rate set.
          </p>
          {!canWriteRateSets ? (
            <p className="mt-2 text-sm text-slate-500">
              You have read-only access; add, edit, and delete require the
              corresponding rate set permissions.
            </p>
          ) : null}
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadRateSets()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openAddDrawer}
              disabled={!canWriteRateSets}
              title={
                !canWriteRateSets
                  ? "You need rate_sets.write to add rate sets."
                  : undefined
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Add Rate Set
            </button>
          </div>

          {periodFilterError ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {periodFilterError}
            </div>
          ) : null}

          {loadError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {loadError}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:flex-wrap xl:items-end">
            <div className="min-w-[min(100%,16rem)] flex-1">
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="rateSetSearch"
              >
                Name, Description
              </label>
              <input
                id="rateSetSearch"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search name or description"
                className={INPUT_CLASS_NAME}
              />
            </div>

            <div className="min-w-[min(100%,24rem)] flex-1">
              <span className="text-sm font-medium text-slate-500">Period</span>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={periodStartInput}
                  onChange={(e) => setPeriodStartInput(e.target.value)}
                  aria-label="Period start date"
                  className={PERIOD_DATE_INPUT_CLASS}
                />
                <span className="text-slate-400" aria-hidden>
                  →
                </span>
                <input
                  type="date"
                  value={periodEndInput}
                  onChange={(e) => setPeriodEndInput(e.target.value)}
                  aria-label="Period end date"
                  className={PERIOD_DATE_INPUT_CLASS}
                />
              </div>
            </div>

            <div className="min-w-48">
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="rateSetActiveFilter"
              >
                Active
              </label>
              <select
                id="rateSetActiveFilter"
                value={activeFilter}
                onChange={(e) =>
                  setActiveFilter(e.target.value as ActiveFilterValue)
                }
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">Name</th>
                  <th className="px-3 py-3 font-semibold">Description</th>
                  <th className="px-3 py-3 font-semibold">Start Date</th>
                  <th className="px-3 py-3 font-semibold">End Date</th>
                  <th className="px-3 py-3 text-center font-semibold">Active</th>
                  <th className="px-3 py-3 text-center font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-10 text-center text-sm text-slate-500"
                    >
                      No rate sets found for the current filters.
                    </td>
                  </tr>
                ) : null}

                {rows.map((row) => (
                  <tr key={row.id} className="transition hover:bg-slate-50">
                    <td className="px-3 py-4 font-medium text-slate-900">
                      {row.name || "—"}
                    </td>
                    <td className="max-w-xs truncate px-3 py-4 text-slate-700">
                      {row.description ?? "—"}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatDateUtc(row.start_date)}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatDateUtc(row.end_date)}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex justify-center">
                        <ActiveIndicator active={isRateSetActive(row)} />
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditRateSetId(row.id)}
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          {canWriteRateSets ? "Edit" : "View"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(row)}
                          disabled={!canDeleteRateSets || deletingId === row.id}
                          title={
                            !canDeleteRateSets
                              ? "You need rate_sets.delete to remove rate sets."
                              : undefined
                          }
                          className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingId === row.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm text-slate-500">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safePage <= 1 || isLoading}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {"<"}
            </button>

            <span className="inline-flex min-w-8 items-center justify-center rounded-md border border-blue-200 bg-white px-3 py-1.5 font-medium text-blue-600">
              {safePage}
            </span>

            <button
              type="button"
              onClick={() =>
                setCurrentPage((page) => Math.min(totalPages, page + 1))
              }
              disabled={safePage >= totalPages || isLoading}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {">"}
            </button>

            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              disabled={isLoading}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 disabled:opacity-50"
            >
              <option value={10}>10 / page</option>
              <option value={20}>20 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
        </div>
      </section>

      {addDrawerOpen ? (
        <div className="fixed inset-0 z-60 flex justify-end bg-slate-900/60">
          <div
            className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-rate-set-title"
          >
            <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeAddDrawer}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <span className="block text-xl leading-none" aria-hidden>
                  ×
                </span>
              </button>
              <h3
                id="add-rate-set-title"
                className="text-xl font-semibold tracking-tight text-slate-900"
              >
                Add Rate Set
              </h3>
            </div>

            <form
              onSubmit={(e) => void submitAddRateSet(e)}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4"
            >
              {addDrawerError ? (
                <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {addDrawerError}
                </div>
              ) : null}

              <label className="text-sm font-medium text-slate-600">
                <span className="text-rose-600">*</span> Name
                <input
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    setAddFieldErrors((p) => ({ ...p, name: undefined }));
                  }}
                  placeholder="e.g., November 2025"
                  autoComplete="off"
                  className={INPUT_CLASS_NAME}
                />
                {addFieldErrors.name ? (
                  <p className="mt-1 text-xs text-rose-600">
                    {addFieldErrors.name}
                  </p>
                ) : null}
              </label>

              <label className="mt-5 text-sm font-medium text-slate-600">
                Description
                <textarea
                  value={formDescription}
                  onChange={(e) => {
                    setFormDescription(e.target.value);
                    setAddFieldErrors((p) => ({ ...p, description: undefined }));
                  }}
                  placeholder="e.g., NDIS Pricing Arrangements and Price Limits effective from 24 November 2025"
                  rows={4}
                  className={TEXTAREA_CLASS_NAME}
                />
                {addFieldErrors.description ? (
                  <p className="mt-1 text-xs text-rose-600">
                    {addFieldErrors.description}
                  </p>
                ) : null}
              </label>

              <label className="mt-5 text-sm font-medium text-slate-600">
                <span className="text-rose-600">*</span> Start Date
                <input
                  type="date"
                  value={formStartDate}
                  onChange={(e) => {
                    setFormStartDate(e.target.value);
                    setAddFieldErrors((p) => ({
                      ...p,
                      start_date: undefined,
                    }));
                    setAddDrawerError(null);
                  }}
                  className={INPUT_CLASS_NAME}
                />
                {addFieldErrors.start_date ? (
                  <p className="mt-1 text-xs text-rose-600">
                    {addFieldErrors.start_date}
                  </p>
                ) : null}
                {addDateMessageTarget === "start" ? (
                  <RateSetDateCheckMessages
                    overlapLabels={addDateOverlapLabels}
                    gapLabels={addDateGapLabels}
                  />
                ) : null}
              </label>

              <label className="mt-5 text-sm font-medium text-slate-600">
                End Date
                <input
                  type="date"
                  value={formEndDate}
                  min={formStartDate || undefined}
                  onChange={(e) => {
                    setFormEndDate(e.target.value);
                    setAddFieldErrors((p) => ({ ...p, end_date: undefined }));
                    setAddDrawerError(null);
                  }}
                  className={INPUT_CLASS_NAME}
                />
                {addFieldErrors.end_date ? (
                  <p className="mt-1 text-xs text-rose-600">
                    {addFieldErrors.end_date}
                  </p>
                ) : null}
                {addDateMessageTarget === "end" ? (
                  <RateSetDateCheckMessages
                    overlapLabels={addDateOverlapLabels}
                    gapLabels={addDateGapLabels}
                  />
                ) : null}
              </label>

              <div className="mt-5 flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-slate-600">
                  Active
                </span>
                <Toggle checked={formActive} onChange={setFormActive} />
              </div>
              {addFieldErrors.active ? (
                <p className="mt-1 text-xs text-rose-600">
                  {addFieldErrors.active}
                </p>
              ) : null}

              <div className="mt-6">
                <p className="text-sm font-medium text-slate-600">
                  Upload NDIS Pricing Arrangements and Price Limits Excel
                </p>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="sr-only"
                  id="rate-set-excel-upload"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setExcelLabel(f?.name ?? "");
                    setAddDrawerError(null);
                  }}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => excelInputRef.current?.click()}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                  >
                    Select File
                  </button>
                  {excelLabel !== "" ? (
                    <span className="text-xs text-slate-500">{excelLabel}</span>
                  ) : null}
                </div>
              </div>

              {addFieldErrors.form ? (
                <p className="mt-4 text-sm text-rose-600">
                  {addFieldErrors.form}
                </p>
              ) : null}

              <div className="mt-auto flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  onClick={closeAddDrawer}
                  disabled={addSubmitting}
                  className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    addSubmitting ||
                    isCheckingAddDates ||
                    addDateOverlapLabels.length > 0
                  }
                  className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
                >
                  {addSubmitting
                    ? "Saving..."
                    : isCheckingAddDates
                      ? "Checking..."
                      : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <RateSetEditDialog
        rateSetId={editRateSetId}
        readOnly={!canWriteRateSets}
        onClose={() => setEditRateSetId(null)}
        onSaved={async (message) => {
          setToastMessage(message);
          await loadRateSets();
        }}
      />
    </div>
  );
}
