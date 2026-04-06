export type UserRoleStatusFilter = "active" | "inactive" | "all";

/** `GET /api/rbac-roles/options` — id + label for selects. */
export type RbacRoleOptionRow = {
  id: number;
  label: string;
};

/** Row shape for paginated list queries (no permission columns). */
export type UserRoleListRow = {
  id: number;
  code: string;
  label: string;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  is_deleted: boolean;
  /** System / gateway default role (e.g. full access); not user-assignable as mutable. */
  is_default: boolean;
};

export type UserRoleRow = {
  id: number;
  code: string;
  label: string;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  is_deleted: boolean;
  is_default: boolean;
  /**
   * Permission slugs: from `rbac_user_role_permission` → `rbac_permission.code` when
   * rows exist; else legacy JSON on the role row.
   */
  permissions: string[];
  /** Junction `rbac_user_role_permission.permission_id` for this role; empty if only JSON. */
  permission_ids: number[];
};

/** `GET /api/rbac-roles/:id` (gateway-style body under `data`). */
export type RbacRoleDetailItem = {
  id: number;
  code: string;
  label: string;
  is_default: boolean;
  created_at: string;
  deactivated_at: string | null;
  permission_ids: number[];
};

export function toRbacRoleDetailItem(row: UserRoleRow): RbacRoleDetailItem {
  const permission_ids = [...new Set(row.permission_ids)].sort((a, b) => a - b);

  return {
    id: row.id,
    code: row.code,
    label: row.label,
    is_default: row.is_default,
    created_at: toIso8601UtcZ(row.created_at),
    deactivated_at:
      row.deactivated_at === null ? null : toIso8601UtcZ(row.deactivated_at),
    permission_ids,
  };
}

export type UserRole = {
  id: number;
  code: string;
  label: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  /** Mirrors `is_default` from `rbac_role` / `user_role`. */
  isDefault: boolean;
};

/** List payload for `GET /api/rbac-roles` — roles only. */
export type RbacRoleListItem = {
  id: number;
  code: string;
  label: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
};

export function toRbacRoleListItem(row: UserRoleListRow): RbacRoleListItem {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    is_default: row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deactivated_at: row.deactivated_at,
  };
}

export function mapRbacRoleListItemToUserRole(item: RbacRoleListItem): UserRole {
  return {
    id: item.id,
    code: item.code,
    label: item.label,
    active: item.deactivated_at === null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    deactivatedAt: item.deactivated_at,
    isDefault: item.is_default,
  };
}

export type UserRoleListFilters = {
  search: string;
  status: UserRoleStatusFilter;
  limit: number;
  offset: number;
};

export type CreateUserRoleInput = {
  label: string;
  code: string;
  active: boolean;
  permissions: string[];
};

export type UserRoleCreateRowInput = {
  label: string;
  code: string;
  deactivated_at: string | null;
  permissions: string[];
};

export type UpdateUserRoleInput = Partial<CreateUserRoleInput>;

export function toIso8601UtcZ(dbTimestamp: string): string {
  const ms = Date.parse(dbTimestamp);

  if (!Number.isFinite(ms)) {
    return dbTimestamp;
  }

  return new Date(ms).toISOString();
}

export function normalizeUserRoleListRowTimestamps(
  row: UserRoleListRow,
): UserRoleListRow {
  return {
    ...row,
    created_at: toIso8601UtcZ(row.created_at),
    updated_at: toIso8601UtcZ(row.updated_at),
    deactivated_at:
      row.deactivated_at === null ? null : toIso8601UtcZ(row.deactivated_at),
  };
}

export function normalizeUserRoleRowTimestamps(row: UserRoleRow): UserRoleRow {
  return {
    ...row,
    created_at: toIso8601UtcZ(row.created_at),
    updated_at: toIso8601UtcZ(row.updated_at),
    deactivated_at:
      row.deactivated_at === null ? null : toIso8601UtcZ(row.deactivated_at),
    permissions: Array.from(new Set(row.permissions)),
    permission_ids: [...new Set(row.permission_ids)].sort((a, b) => a - b),
  };
}

export function mapUserRoleRowToCreateUserRoleInput(
  row: UserRoleRow,
): CreateUserRoleInput {
  return {
    label: row.label,
    code: row.code,
    active: row.deactivated_at === null,
    permissions: [...row.permissions],
  };
}
