export type PermissionCategory = {
  id: string;
  label: string;
  permissions: readonly { slug: string; label: string }[];
};

/** Admin UI catalog — keep in sync with server allowlist in user-role.service. */
export const PERMISSION_CATEGORIES: readonly PermissionCategory[] = [
  {
    id: "audit_logs",
    label: "Audit Logs",
    permissions: [{ slug: "audit_logs.read", label: "Read audit logs" }],
  },
  {
    id: "auth_sessions",
    label: "Auth Sessions",
    permissions: [
      { slug: "auth_sessions.delete", label: "Delete auth sessions" },
      { slug: "auth_sessions.read", label: "Read auth sessions" },
      { slug: "auth_sessions.revoke", label: "Revoke auth sessions" },
    ],
  },
  {
    id: "clients",
    label: "Clients",
    permissions: [
      { slug: "clients.write", label: "Add or edit clients" },
      { slug: "clients.delete", label: "Delete clients" },
      { slug: "clients.read", label: "Read clients" },
    ],
  },
  {
    id: "genders",
    label: "Genders",
    permissions: [
      { slug: "genders.write", label: "Add or edit genders" },
      { slug: "genders.delete", label: "Delete genders" },
      { slug: "genders.read", label: "Read genders" },
    ],
  },
  {
    id: "invoices",
    label: "Invoices",
    permissions: [
      { slug: "invoices.write", label: "Add or edit invoices" },
      { slug: "invoices.delete", label: "Delete invoices" },
      { slug: "invoices.read", label: "Read invoices" },
    ],
  },
  {
    id: "providers",
    label: "Providers",
    permissions: [
      { slug: "providers.write", label: "Add or edit providers" },
      { slug: "providers.delete", label: "Delete providers" },
      { slug: "providers.read", label: "Read providers" },
    ],
  },
  {
    id: "rate_sets",
    label: "Rate Sets",
    permissions: [
      { slug: "rate_sets.write", label: "Add or edit rate sets" },
      { slug: "rate_sets.delete", label: "Delete rate sets" },
      { slug: "rate_sets.import", label: "Import rate sets" },
      { slug: "rate_sets.read", label: "Read rate sets" },
    ],
  },
  {
    id: "user_roles",
    label: "User Roles",
    permissions: [
      { slug: "user_roles.write", label: "Add or edit user roles" },
      { slug: "user_roles.delete", label: "Delete user roles" },
      { slug: "user_roles.read", label: "Read user roles" },
    ],
  },
  {
    id: "users",
    label: "Users",
    permissions: [
      { slug: "users.write", label: "Add or edit users" },
      { slug: "users.delete", label: "Delete users" },
      { slug: "users.read", label: "Read users" },
    ],
  },
] as const;

export const ALL_KNOWN_PERMISSION_SLUGS: ReadonlySet<string> = new Set(
  PERMISSION_CATEGORIES.flatMap((c) => c.permissions.map((p) => p.slug)),
);

/** Stable order for API / Super Admin full-permission grants. */
export function getAllPermissionSlugsSorted(): string[] {
  return [...ALL_KNOWN_PERMISSION_SLUGS].sort((a, b) => a.localeCompare(b));
}

export const DEFAULT_PERMISSION_CATEGORY_ID = PERMISSION_CATEGORIES[0]?.id ?? "audit_logs";

/** ISO timestamp used on GET /api/rbac-permissions rows (matches gateway contract). */
export const RBAC_PERMISSION_API_CREATED_AT = "2026-03-13T03:24:25.042Z";

/**
 * Numeric ids aligned with gateway `/api/rbac-permissions` / `rbac_permission.id` for joins
 * in `rbac_user_role_permission`.
 */
export const RBAC_PERMISSION_GATEWAY_ID_BY_CODE: Readonly<Record<string, number>> =
  Object.freeze({
    "clients.read": 1,
    "clients.write": 2,
    "clients.delete": 3,
    "providers.read": 4,
    "providers.write": 5,
    "providers.delete": 6,
    "rate_sets.read": 7,
    "rate_sets.write": 8,
    "rate_sets.delete": 9,
    "rate_sets.import": 10,
    "invoices.read": 11,
    "invoices.write": 12,
    "invoices.delete": 13,
    "users.read": 14,
    "users.write": 15,
    "users.delete": 16,
    "user_roles.read": 17,
    "user_roles.write": 18,
    "user_roles.delete": 19,
    "genders.read": 20,
    "genders.write": 21,
    "genders.delete": 22,
    "auth_sessions.read": 23,
    "auth_sessions.revoke": 24,
    "auth_sessions.delete": 25,
    "audit_logs.read": 26,
  });

export type RbacPermissionApiRow = {
  id: number;
  code: string;
  label: string;
  created_at: string;
};

/** Rows for `rbac_permission` seed / GET /api/rbac-permissions (sorted by id). */
export const RBAC_PERMISSION_SEEDS: readonly RbacPermissionApiRow[] =
  PERMISSION_CATEGORIES.flatMap((category) => category.permissions).map(
    (permission) => {
      const id = RBAC_PERMISSION_GATEWAY_ID_BY_CODE[permission.slug];

      if (id === undefined) {
        throw new Error(
          `RBAC_PERMISSION_GATEWAY_ID_BY_CODE missing entry for ${permission.slug}`,
        );
      }

      return {
        id,
        code: permission.slug,
        label: permission.label,
        created_at: RBAC_PERMISSION_API_CREATED_AT,
      };
    },
  );

function assertEveryCatalogSlugHasGatewayId(): void {
  for (const slug of ALL_KNOWN_PERMISSION_SLUGS) {
    if (RBAC_PERMISSION_GATEWAY_ID_BY_CODE[slug] === undefined) {
      throw new Error(
        `RBAC_PERMISSION_GATEWAY_ID_BY_CODE missing entry for catalog slug ${slug}`,
      );
    }
  }

  const seedCodes = new Set(RBAC_PERMISSION_SEEDS.map((row) => row.code));

  if (seedCodes.size !== ALL_KNOWN_PERMISSION_SLUGS.size) {
    throw new Error("RBAC permission seed count does not match catalog.");
  }
}

assertEveryCatalogSlugHasGatewayId();

/**
 * Flat list for GET /api/rbac-permissions (same shape as gateway); ids match
 * `rbac_permission` when the DB is seeded.
 */
export function getRbacPermissionsApiRows(): RbacPermissionApiRow[] {
  return [...RBAC_PERMISSION_SEEDS].sort((a, b) => a.id - b.id);
}

/** Gateway permission ids in sort order (e.g. Super Admin `permission_ids`). */
export function getRbacPermissionGatewayIdsSorted(): number[] {
  return [...RBAC_PERMISSION_SEEDS].sort((a, b) => a.id - b.id).map((r) => r.id);
}
