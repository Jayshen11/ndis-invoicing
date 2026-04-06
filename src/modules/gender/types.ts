export type GenderStatusFilter = "active" | "inactive" | "all";

export type GenderRow = {
  id: number;
  code: string;
  label: string;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  /** Logical delete: excluded from list APIs when true. */
  is_deleted: boolean;
};

export type Gender = {
  id: number;
  code: string;
  label: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
};

export type GenderOption = Pick<Gender, "id" | "code" | "label">;

export type GenderListFilters = {
  search: string;
  status: GenderStatusFilter;
  limit: number;
  offset: number;
};

export type CreateGenderInput = {
  label: string;
  code: string;
  active: boolean;
};

/** Insert payload: explicit `deactivated_at` (null = active). */
export type GenderCreateRowInput = {
  label: string;
  code: string;
  deactivated_at: string | null;
};

export type UpdateGenderInput = Partial<CreateGenderInput>;

/** Normalize DB timestamp text to ISO 8601 UTC with `Z` (API responses). */
export function toIso8601UtcZ(dbTimestamp: string): string {
  const ms = Date.parse(dbTimestamp);

  if (!Number.isFinite(ms)) {
    return dbTimestamp;
  }

  return new Date(ms).toISOString();
}

export function normalizeGenderRowTimestamps(row: GenderRow): GenderRow {
  return {
    ...row,
    created_at: toIso8601UtcZ(row.created_at),
    updated_at: toIso8601UtcZ(row.updated_at),
    deactivated_at:
      row.deactivated_at === null ? null : toIso8601UtcZ(row.deactivated_at),
  };
}

export function mapGenderRow(row: GenderRow): Gender {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    active: row.deactivated_at === null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
  };
}

export function mapGenderRowToCreateGenderInput(
  row: GenderRow,
): CreateGenderInput {
  return {
    label: row.label,
    code: row.code,
    active: row.deactivated_at === null,
  };
}
