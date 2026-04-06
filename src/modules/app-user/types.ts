export type AppUserStatusFilter = "active" | "inactive" | "all";

/** DB / repository row (joined role label). */
export type AppUserRow = {
  id: number;
  email: string;
  full_name: string;
  role_id: number;
  role_label: string;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  /** Soft delete timestamp; null when the row is active. */
  deleted_at: string | null;
  /** Seeded system account; cannot be edited or deleted via API. */
  is_default: boolean;
};

/**
 * Public API / gateway JSON shape (`GET /api/app-users`, detail, create, update, delete).
 */
export type AppUserApiRecord = {
  id: number;
  email: string;
  full_name: string;
  role_id: number;
  role_label: string;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deleted_at: string | null;
  is_default: boolean;
};

/** `GET /api/app-users/options` — id + display label for selects. */
export type AppUserOptionRow = {
  id: number;
  label: string;
};

export function toAppUserApiRecord(row: AppUserRow): AppUserApiRecord {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role_id: row.role_id,
    role_label: row.role_label,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deactivated_at: row.deactivated_at,
    is_default: row.is_default,
    deleted_at: row.deleted_at,
  };
}

export type AppUserListFilters = {
  search: string;
  status: AppUserStatusFilter;
  role_id?: number;
  limit: number;
  offset: number;
};

/** Row fields for `INSERT INTO app_user` + `rbac_user_role` (passwords in `auth_password`). */
export type AppUserCreateRowInput = {
  email: string;
  full_name: string;
  /** Stored in `rbac_user_role.role_id` (joined to `rbac_role` / `user_role`). */
  role_id: number;
  deactivated_at: string | null;
};

export type CreateAppUserInput = {
  email: string;
  full_name: string;
  role_id: number;
  active: boolean;
};

export type UpdateAppUserInput = {
  email?: string;
  full_name?: string;
  role_id?: number;
  active?: boolean;
  /** Plain password for credential rotation; hashed server-side only. */
  password?: string;
};

export type AppUser = {
  id: number;
  email: string;
  fullName: string;
  roleId: number;
  roleLabel: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
};

export function mapAppUserRecord(row: AppUserApiRecord): AppUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    roleId: row.role_id,
    roleLabel: row.role_label,
    active: row.deactivated_at === null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDefault: row.is_default,
  };
}

export function normalizeAppUserRowTimestamps(row: AppUserRow): AppUserRow {
  return {
    ...row,
    created_at: toIso8601UtcZ(row.created_at),
    updated_at: toIso8601UtcZ(row.updated_at),
    deactivated_at:
      row.deactivated_at === null ? null : toIso8601UtcZ(row.deactivated_at),
    deleted_at:
      row.deleted_at === null ? null : toIso8601UtcZ(row.deleted_at),
  };
}

export function normalizeAppUserApiRecord(row: AppUserApiRecord): AppUserApiRecord {
  return {
    ...row,
    created_at: toIso8601UtcZ(row.created_at),
    updated_at: toIso8601UtcZ(row.updated_at),
    deactivated_at:
      row.deactivated_at === null ? null : toIso8601UtcZ(row.deactivated_at),
    deleted_at:
      row.deleted_at === null ? null : toIso8601UtcZ(row.deleted_at),
  };
}

function toIso8601UtcZ(value: string): string {
  const ms = Date.parse(value);

  if (!Number.isFinite(ms)) {
    return value;
  }

  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
