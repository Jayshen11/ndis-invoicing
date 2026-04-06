import * as XLSX from "xlsx";

/** Thrown for workbook shape issues; message is safe to show to API clients. */
export class NdisWorkbookParseError extends Error {
  readonly code:
    | "NOT_EXCEL_WORKBOOK"
    | "NO_SHEETS"
    | "READ_FAILED"
    | "NO_VALID_ROWS";

  constructor(code: NdisWorkbookParseError["code"], message: string) {
    super(message);
    this.name = "NdisWorkbookParseError";
    this.code = code;
  }
}

/** 0-based column indices per NDIS pricing workbook spec. */
export const COL = {
  A_ITEM_NUMBER: 0,
  B_ITEM_NAME: 1,
  F_CATEGORY_NUMBER: 5,
  H_CATEGORY_NAME: 7,
  I_UNIT: 8,
  J_QUOTE: 9,
  K_START: 10,
  L_END: 11,
  M_ACT: 12,
  N_NSW: 13,
  O_NT: 14,
  P_QLD: 15,
  Q_SA: 16,
  R_TAS: 17,
  S_VIC: 18,
  T_WA: 19,
  U_REMOTE: 20,
  V_VERY_REMOTE: 21,
  W_NF2F: 22,
  X_TRAVEL: 23,
  Y_SHORT_NOTICE: 24,
  Z_NDIA_REPORTS: 25,
  AA_IRREGULAR_SIL: 26,
  AB_TYPE: 27,
} as const;

const REGION_COLS: { col: number; code: string }[] = [
  { col: COL.M_ACT, code: "ACT" },
  { col: COL.N_NSW, code: "NSW" },
  { col: COL.O_NT, code: "NT" },
  { col: COL.P_QLD, code: "QLD" },
  { col: COL.Q_SA, code: "SA" },
  { col: COL.R_TAS, code: "TAS" },
  { col: COL.S_VIC, code: "VIC" },
  { col: COL.T_WA, code: "WA" },
  { col: COL.U_REMOTE, code: "REMOTE" },
  { col: COL.V_VERY_REMOTE, code: "VERY_REMOTE" },
];

export type NdisExcelHeaderMeta = {
  regionCodes: string[];
  attributeLabels: Partial<Record<string, string>>;
};

type ParsedColumnMap = {
  itemNumber: number;
  itemName: number;
  categoryNumber: number;
  categoryName: number;
  unit: number | null;
  quote: number | null;
  startDate: number;
  endDate: number | null;
  type: number | null;
  attrNf2f: number | null;
  attrTravel: number | null;
  attrShortNotice: number | null;
  attrNdiaReports: number | null;
  attrIrregularSil: number | null;
  regionByCode: Map<string, number>;
};

const REQUIRED_HEADER_ALIASES = {
  itemNumber: [
    "support item number",
    "support item ref no",
    "support item reference no",
    "item number",
    "item ref no",
    "reference no",
  ],
  itemName: ["support item name", "item name"],
  categoryNumber: [
    "support category number",
    "registration group number",
    "category number",
    "group number",
  ],
  categoryName: [
    "support category name",
    "registration group name",
    "category name",
    "group name",
  ],
  startDate: ["start date", "date from", "from date", "effective from"],
} as const;

const OPTIONAL_HEADER_ALIASES = {
  endDate: ["end date", "date to", "to date", "effective to"],
  unit: ["unit", "measure"],
  quote: ["quote"],
  type: ["type"],
  attrNf2f: [
    "non face to face support provision",
    "non face to face",
  ],
  attrTravel: ["provider travel", "travel"],
  attrShortNotice: [
    "short notice cancellations",
    "short notice cancellation",
  ],
  attrNdiaReports: ["ndia requested reports", "requested reports"],
  attrIrregularSil: ["irregular sil supports", "irregular sil"],
} as const;

const REGION_HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ACT: ["act"],
  NSW: ["nsw"],
  NT: ["nt"],
  QLD: ["qld"],
  SA: ["sa"],
  TAS: ["tas"],
  VIC: ["vic"],
  WA: ["wa"],
  REMOTE: ["remote"],
  VERY_REMOTE: ["very remote", "very remote mm", "very remote area"],
};

export type NdisExcelLogicalRow = {
  /** 1-based sheet row; used to apply “last row wins” for item metadata across price windows. */
  sourceRowIndex: number;
  /** Spec duplicate key: columns A + F + K + L (item, category, price window). */
  dedupeKey: string;
  itemNumber: string;
  itemName: string;
  categoryNumber: string;
  categoryName: string;
  unit: string | null;
  attrQuote: boolean;
  attrNf2f: boolean;
  attrTravel: boolean;
  attrShortNotice: boolean;
  attrNdiaReports: boolean;
  attrIrregularSil: boolean;
  priceStart: Date;
  priceEnd: Date | null;
  typeLabelRaw: string | null;
  typeCode: string | null;
  /** Keys are canonical region codes (M–V → ACT … VERY_REMOTE), not arbitrary header text. */
  regionPrices: Map<string, number>;
};

export function headerToRegionCode(headerCell: unknown): string {
  const s = String(headerCell ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  return s === "" ? "UNKNOWN" : s;
}

export function excelTypeCodeFromLabel(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "_");
}

export function parseYesNo(value: unknown): boolean {
  const s = String(value ?? "").trim();

  if (s === "") {
    return false;
  }

  const u = s.toUpperCase();

  return u === "Y" || u === "YES" || u === "TRUE" || u === "1";
}

function cellToDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const d = XLSX.SSF.parse_date_code(value);

    if (d) {
      return new Date(Date.UTC(d.y, d.m - 1, d.d));
    }
  }

  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);

  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);

  if (compact) {
    return new Date(
      Date.UTC(
        Number(compact[1]),
        Number(compact[2]) - 1,
        Number(compact[3]),
      ),
    );
  }

  const d2 = new Date(s);

  return Number.isNaN(d2.getTime()) ? null : d2;
}

function cellToMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const s = String(value).replace(/[$,]/g, "").trim();
  const n = Number.parseFloat(s);

  return Number.isFinite(n) ? n : null;
}

function rowStr(row: unknown[], idx: number): string {
  const v = row[idx];

  return v === null || v === undefined ? "" : String(v).trim();
}

function normalizeHeaderLabel(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findColumnIndex(
  labels: string[],
  candidates: readonly string[],
): number | null {
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];

    if (label === "") {
      continue;
    }

    if (candidates.some((candidate) => label.includes(candidate))) {
      return index;
    }
  }

  return null;
}

function findExactColumnIndex(
  labels: string[],
  candidates: readonly string[],
): number | null {
  for (const candidate of candidates) {
    const index = labels.indexOf(candidate);

    if (index !== -1) {
      return index;
    }
  }

  return null;
}

function resolveColumnIndex(
  labels: string[],
  candidates: readonly string[],
  fallback: number | null = null,
): number | null {
  return (
    findExactColumnIndex(labels, candidates) ??
    findColumnIndex(labels, candidates) ??
    fallback
  );
}

function mapColumnsFromHeaderRow(row: unknown[]): ParsedColumnMap | null {
  const labels = row.map((cell) => normalizeHeaderLabel(cell));

  const itemNumber = resolveColumnIndex(
    labels,
    REQUIRED_HEADER_ALIASES.itemNumber,
    COL.A_ITEM_NUMBER,
  );
  const itemName = resolveColumnIndex(
    labels,
    REQUIRED_HEADER_ALIASES.itemName,
    COL.B_ITEM_NAME,
  );
  const categoryNumber = resolveColumnIndex(
    labels,
    REQUIRED_HEADER_ALIASES.categoryNumber,
    COL.F_CATEGORY_NUMBER,
  );
  const categoryName = resolveColumnIndex(
    labels,
    REQUIRED_HEADER_ALIASES.categoryName,
    COL.H_CATEGORY_NAME,
  );
  const startDate = resolveColumnIndex(
    labels,
    REQUIRED_HEADER_ALIASES.startDate,
    COL.K_START,
  );
  const endDate = resolveColumnIndex(labels, OPTIONAL_HEADER_ALIASES.endDate);
  const unit = resolveColumnIndex(labels, OPTIONAL_HEADER_ALIASES.unit);
  const quote = resolveColumnIndex(labels, OPTIONAL_HEADER_ALIASES.quote);
  const type = resolveColumnIndex(labels, OPTIONAL_HEADER_ALIASES.type);
  const attrNf2f = resolveColumnIndex(
    labels,
    OPTIONAL_HEADER_ALIASES.attrNf2f,
  );
  const attrTravel = resolveColumnIndex(
    labels,
    OPTIONAL_HEADER_ALIASES.attrTravel,
  );
  const attrShortNotice = resolveColumnIndex(
    labels,
    OPTIONAL_HEADER_ALIASES.attrShortNotice,
  );
  const attrNdiaReports = resolveColumnIndex(
    labels,
    OPTIONAL_HEADER_ALIASES.attrNdiaReports,
  );
  const attrIrregularSil = resolveColumnIndex(
    labels,
    OPTIONAL_HEADER_ALIASES.attrIrregularSil,
  );

  const regionByCode = new Map<string, number>();

  for (const [code, candidates] of Object.entries(REGION_HEADER_ALIASES)) {
    const index = resolveColumnIndex(labels, candidates);
    if (index !== null) {
      regionByCode.set(code, index);
    }
  }

  const hasRequiredColumns =
    itemNumber !== null &&
    itemName !== null &&
    categoryNumber !== null &&
    categoryName !== null &&
    startDate !== null;
  const hasAnyRegion = regionByCode.size > 0;

  if (!hasRequiredColumns || !hasAnyRegion) {
    return null;
  }

  return {
    itemNumber,
    itemName,
    categoryNumber,
    categoryName,
    unit,
    quote,
    startDate,
    endDate,
    type,
    attrNf2f,
    attrTravel,
    attrShortNotice,
    attrNdiaReports,
    attrIrregularSil,
    regionByCode,
  };
}

function findHeaderRow(matrix: unknown[][]): {
  headerRowIndex: number;
  columnMap: ParsedColumnMap;
} | null {
  const scanLimit = Math.min(matrix.length, 40);

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
    const row = matrix[rowIndex];

    if (!Array.isArray(row)) {
      continue;
    }

    const columnMap = mapColumnsFromHeaderRow(row);

    if (columnMap !== null) {
      return {
        headerRowIndex: rowIndex,
        columnMap,
      };
    }
  }

  return null;
}

function normalizeDedupePart(s: string): string {
  return s.trim().toLowerCase();
}

function mergeRegionPrices(
  into: Map<string, number>,
  from: Map<string, number>,
): void {
  for (const [k, v] of from) {
    into.set(k, v);
  }
}

function mergeLogicalRows(
  prev: NdisExcelLogicalRow,
  next: NdisExcelLogicalRow,
): NdisExcelLogicalRow {
  const regionPrices = new Map(prev.regionPrices);

  mergeRegionPrices(regionPrices, next.regionPrices);

  return {
    ...next,
    dedupeKey: prev.dedupeKey,
    sourceRowIndex: Math.max(prev.sourceRowIndex, next.sourceRowIndex),
    regionPrices,
  };
}

function firstNonEmptyRowValue(row: unknown[], indices: readonly number[]): string {
  for (const index of indices) {
    const value = rowStr(row, index);

    if (value !== "") {
      return value;
    }
  }

  return "";
}

function tryParseKnown28ColumnLayout(matrix: unknown[][]): {
  header: NdisExcelHeaderMeta;
  rows: NdisExcelLogicalRow[];
  parseWarnings: string[];
} | null {
  if (matrix.length < 2) {
    return null;
  }

  const warnings = [
    "Used fixed 28-column NDIS workbook fallback parser.",
  ];
  const byKey = new Map<string, NdisExcelLogicalRow>();

  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];

    if (!Array.isArray(row)) {
      continue;
    }

    const itemNumber = rowStr(row, COL.A_ITEM_NUMBER);

    if (itemNumber === "" || normalizeHeaderLabel(itemNumber).includes("support item")) {
      continue;
    }

    const itemName = rowStr(row, COL.B_ITEM_NAME);
    const categoryNumber = firstNonEmptyRowValue(row, [4, 5, 2]);
    const categoryName = firstNonEmptyRowValue(row, [6, 7, 3]);
    const startDate = cellToDate(row[COL.K_START]);

    if (
      itemName === "" ||
      categoryNumber === "" ||
      categoryName === "" ||
      startDate === null
    ) {
      continue;
    }

    const endRaw = cellToDate(row[COL.L_END]);
    const typeRaw = rowStr(row, COL.AB_TYPE);
    const typeCode = typeRaw === "" ? null : excelTypeCodeFromLabel(typeRaw);
    const dedupeKey = [
      normalizeDedupePart(itemNumber),
      normalizeDedupePart(categoryNumber),
      startDate.toISOString().slice(0, 10),
      endRaw ? endRaw.toISOString().slice(0, 10) : "",
    ].join("|");

    const regionPrices = new Map<string, number>();

    for (const { col, code } of REGION_COLS) {
      const price = cellToMoney(row[col]);

      if (price !== null) {
        regionPrices.set(code, price);
      }
    }

    const logical: NdisExcelLogicalRow = {
      sourceRowIndex: r + 1,
      dedupeKey,
      itemNumber,
      itemName,
      categoryNumber,
      categoryName,
      unit: rowStr(row, COL.I_UNIT) || null,
      attrQuote: parseYesNo(row[COL.J_QUOTE]),
      attrNf2f: parseYesNo(row[COL.W_NF2F]),
      attrTravel: parseYesNo(row[COL.X_TRAVEL]),
      attrShortNotice: parseYesNo(row[COL.Y_SHORT_NOTICE]),
      attrNdiaReports: parseYesNo(row[COL.Z_NDIA_REPORTS]),
      attrIrregularSil: parseYesNo(row[COL.AA_IRREGULAR_SIL]),
      priceStart: startDate,
      priceEnd: endRaw,
      typeLabelRaw: typeRaw === "" ? null : typeRaw,
      typeCode,
      regionPrices,
    };

    const existing = byKey.get(dedupeKey);

    if (existing) {
      byKey.set(dedupeKey, mergeLogicalRows(existing, logical));
    } else {
      byKey.set(dedupeKey, logical);
    }
  }

  if (byKey.size === 0) {
    return null;
  }

  return {
    header: {
      regionCodes: REGION_COLS.map((entry) => entry.code),
      attributeLabels: {
        IS_QUOTE_REQUIRED: "Quote",
        IS_NF2F_SUPPORT_PROVISION: "Non-Face-to-Face Support Provision",
        IS_PROVIDER_TRAVEL: "Provider Travel",
        IS_SHORT_NOTICE_CANCEL: "Short Notice Cancellations.",
        IS_NDIA_REQUESTED_REPORTS: "NDIA Requested Reports",
        IS_IRREGULAR_SIL_SUPPORTS: "Irregular SIL Supports",
      },
    },
    rows: [...byKey.values()],
    parseWarnings: warnings,
  };
}

function summarizeSheetForDebug(sheetName: string, matrix: unknown[][]): string {
  const lines: string[] = [`sheet=${sheetName}`, `rows=${matrix.length}`];
  const scanLimit = Math.min(matrix.length, 12);

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
    const row = matrix[rowIndex];

    if (!Array.isArray(row)) {
      continue;
    }

    const values = [
      `A=${rowStr(row, 0)}`,
      `B=${rowStr(row, 1)}`,
      `C=${rowStr(row, 2)}`,
      `D=${rowStr(row, 3)}`,
      `E=${rowStr(row, 4)}`,
      `F=${rowStr(row, 5)}`,
      `G=${rowStr(row, 6)}`,
      `H=${rowStr(row, 7)}`,
      `I=${rowStr(row, 8)}`,
      `J=${rowStr(row, 9)}`,
      `K=${rowStr(row, 10)}`,
      `L=${rowStr(row, 11)}`,
    ];

    lines.push(`r${rowIndex + 1}: ${values.join(" | ")}`);
  }

  return lines.join("\n");
}

/**
 * Parses one sheet matrix; returns null if the grid is too small or no usable pricing rows.
 * Expects an NDIS catalogue header row somewhere near the top of the sheet.
 */
function tryParsePricingMatrix(matrix: unknown[][]): {
  header: NdisExcelHeaderMeta;
  rows: NdisExcelLogicalRow[];
  parseWarnings: string[];
} | null {
  if (matrix.length < 2) {
    return null;
  }

  const headerMatch = findHeaderRow(matrix);

  if (headerMatch === null) {
    return null;
  }

  const warnings: string[] = [];
  const { headerRowIndex, columnMap } = headerMatch;
  const headerRow = matrix[headerRowIndex] as unknown[];
  const regionCodes: string[] = [];

  for (const [code, index] of columnMap.regionByCode) {
    const raw = headerRow[index];
    const parsed =
      raw === null || raw === undefined || String(raw).trim() === ""
        ? code
        : headerToRegionCode(raw);
    regionCodes.push(parsed);
  }

  const attributeLabels: Partial<Record<string, string>> = {};

  const attributeHeaderCols = [
    { col: columnMap.quote, code: "IS_QUOTE_REQUIRED" },
    { col: columnMap.attrNf2f, code: "IS_NF2F_SUPPORT_PROVISION" },
    { col: columnMap.attrTravel, code: "IS_PROVIDER_TRAVEL" },
    { col: columnMap.attrShortNotice, code: "IS_SHORT_NOTICE_CANCEL" },
    { col: columnMap.attrNdiaReports, code: "IS_NDIA_REQUESTED_REPORTS" },
    { col: columnMap.attrIrregularSil, code: "IS_IRREGULAR_SIL_SUPPORTS" },
  ];

  for (const { col, code } of attributeHeaderCols) {
    if (col === null) {
      continue;
    }

    const lab = headerRow[col];

    if (lab !== null && lab !== undefined && String(lab).trim() !== "") {
      attributeLabels[code] = String(lab).trim();
    }
  }

  const header: NdisExcelHeaderMeta = { regionCodes, attributeLabels };
  const byKey = new Map<string, NdisExcelLogicalRow>();

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] as unknown[];

    if (!Array.isArray(row)) {
      continue;
    }

    const itemNumber = rowStr(row, columnMap.itemNumber);

    if (itemNumber === "") {
      continue;
    }

    const categoryNumber = rowStr(row, columnMap.categoryNumber);
    const categoryName = rowStr(row, columnMap.categoryName);
    const itemName = rowStr(row, columnMap.itemName);

    if (categoryNumber === "" || categoryName === "" || itemName === "") {
      warnings.push(
        `Row ${r + 1}: missing category (F/H) or item name (B); skipped.`,
      );
      continue;
    }

    const k = cellToDate(row[columnMap.startDate]);

    if (!k) {
      warnings.push(`Row ${r + 1}: missing or invalid start date (K); skipped.`);
      continue;
    }

    const endRaw =
      columnMap.endDate === null ? null : cellToDate(row[columnMap.endDate]);
    const typeRaw = columnMap.type === null ? "" : rowStr(row, columnMap.type);
    const typeCode =
      typeRaw === "" ? null : excelTypeCodeFromLabel(typeRaw);

    const dedupeKey = [
      normalizeDedupePart(itemNumber),
      normalizeDedupePart(categoryNumber),
      k.toISOString().slice(0, 10),
      endRaw ? endRaw.toISOString().slice(0, 10) : "",
    ].join("|");

    const regionPrices = new Map<string, number>();

    for (const [code, index] of columnMap.regionByCode) {
      const price = cellToMoney(row[index]);

      if (price !== null) {
        regionPrices.set(code, price);
      }
    }

    const logical: NdisExcelLogicalRow = {
      sourceRowIndex: r + 1,
      dedupeKey,
      itemNumber,
      itemName,
      categoryNumber,
      categoryName,
      unit:
        columnMap.unit === null ? null : rowStr(row, columnMap.unit) || null,
      attrQuote:
        columnMap.quote === null ? false : parseYesNo(row[columnMap.quote]),
      attrNf2f:
        columnMap.attrNf2f === null
          ? false
          : parseYesNo(row[columnMap.attrNf2f]),
      attrTravel:
        columnMap.attrTravel === null
          ? false
          : parseYesNo(row[columnMap.attrTravel]),
      attrShortNotice:
        columnMap.attrShortNotice === null
          ? false
          : parseYesNo(row[columnMap.attrShortNotice]),
      attrNdiaReports:
        columnMap.attrNdiaReports === null
          ? false
          : parseYesNo(row[columnMap.attrNdiaReports]),
      attrIrregularSil:
        columnMap.attrIrregularSil === null
          ? false
          : parseYesNo(row[columnMap.attrIrregularSil]),
      priceStart: k,
      priceEnd: endRaw,
      typeLabelRaw: typeRaw === "" ? null : typeRaw,
      typeCode,
      regionPrices,
    };

    const existing = byKey.get(dedupeKey);

    if (existing) {
      byKey.set(dedupeKey, mergeLogicalRows(existing, logical));
    } else {
      byKey.set(dedupeKey, logical);
    }
  }

  if (byKey.size === 0) {
    return null;
  }

  return {
    header,
    rows: [...byKey.values()],
    parseWarnings: warnings,
  };
}

/**
 * SEC: Parses buffer in-memory only; caller must enforce max size before calling.
 * Tries every worksheet: official NDIS workbooks often put the catalogue on a tab other than the first.
 */
export function parseNdisPricingExcel(buffer: Buffer): {
  header: NdisExcelHeaderMeta;
  rows: NdisExcelLogicalRow[];
  parseWarnings: string[];
} {
  // SEC: Reject obviously non-binary uploads; xlsx is ZIP (PK), legacy xls is OLE.
  const isZip =
    buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isOleXls =
    buffer.length >= 4 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0;

  if (!isZip && !isOleXls) {
    throw new NdisWorkbookParseError(
      "NOT_EXCEL_WORKBOOK",
      "File is not a recognised Excel workbook (.xlsx or .xls).",
    );
  }

  let wb: XLSX.WorkBook;

  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw new NdisWorkbookParseError(
      "READ_FAILED",
      "Excel file could not be opened. It may be corrupt, encrypted, or not a real spreadsheet export.",
    );
  }

  if (!wb.SheetNames.length) {
    throw new NdisWorkbookParseError(
      "NO_SHEETS",
      "Workbook contains no worksheets.",
    );
  }

  const sheetNamesTried: string[] = [];
  const sheetDebugSummaries: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];

    if (!sheet) {
      continue;
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
    }) as unknown[][];

    const parsed = tryParsePricingMatrix(matrix);

    if (parsed !== null) {
      const parseWarnings =
        wb.SheetNames.length > 1
          ? [`Using worksheet "${sheetName}".`, ...parsed.parseWarnings]
          : parsed.parseWarnings;

      return {
        header: parsed.header,
        rows: parsed.rows,
        parseWarnings,
      };
    }

    const fallbackParsed = tryParseKnown28ColumnLayout(matrix);

    if (fallbackParsed !== null) {
      const parseWarnings =
        wb.SheetNames.length > 1
          ? [`Using worksheet "${sheetName}".`, ...fallbackParsed.parseWarnings]
          : fallbackParsed.parseWarnings;

      return {
        header: fallbackParsed.header,
        rows: fallbackParsed.rows,
        parseWarnings,
      };
    }

    sheetNamesTried.push(sheetName);
    sheetDebugSummaries.push(summarizeSheetForDebug(sheetName, matrix));
  }

  if (sheetDebugSummaries.length > 0) {
    console.error(
      "NDIS workbook sheet debug summary:\n" + sheetDebugSummaries.join("\n\n"),
    );
  }

  const sheetsHint =
    sheetNamesTried.length > 0
      ? ` Worksheets found: ${sheetNamesTried.join(", ")}.`
      : "";

  throw new NdisWorkbookParseError(
    "NO_VALID_ROWS",
    `No worksheet had usable NDIS catalogue rows. Each data row needs a support item (column A), name (B), category number/name (F/H), and price start date (column K), matching the official Support Catalogue / Price Limits Excel from ndis.gov.au.${sheetsHint}`,
  );
}
