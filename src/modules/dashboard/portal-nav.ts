import type { NavItem } from "@/modules/dashboard/nav-types";

/** Sidebar row plus dashboard card copy. */
export type PortalNavRow = NavItem & {
  href: string;
  description: string;
  requiredPermission: string;
};

/**
 * Primary sidebar links (below Dashboard). Each maps to the list/read slug used by APIs and
 * {@link RequirePermission} on the matching route.
 */
export const PORTAL_PRIMARY_MODULES: PortalNavRow[] = [
  {
    code: "Pa",
    href: "/clients",
    label: "Participants",
    description: "Manage participant records.",
    requiredPermission: "clients.read",
    matcher: (pathname) =>
      pathname.startsWith("/clients") || pathname.startsWith("/participants"),
  },
  {
    code: "Pr",
    href: "/providers",
    label: "Providers",
    description: "Manage provider records.",
    requiredPermission: "providers.read",
    matcher: (pathname) => pathname.startsWith("/providers"),
  },
  {
    code: "I",
    href: "/invoices",
    label: "Invoices",
    description: "Manage invoices.",
    requiredPermission: "invoices.read",
    matcher: (pathname) => pathname.startsWith("/invoices"),
  },
  {
    code: "R",
    href: "/rate-sets",
    label: "Rate Sets",
    description:
      "Manage effective date windows and metadata for each rate set.",
    requiredPermission: "rate_sets.read",
    matcher: (pathname) => pathname.startsWith("/rate-sets"),
  },
];

export const PORTAL_SETTINGS_MODULES: PortalNavRow[] = [
  {
    code: "",
    href: "/settings/users",
    label: "Users",
    description: "Manage application users.",
    requiredPermission: "users.read",
    matcher: (pathname) => pathname.startsWith("/settings/users"),
  },
  {
    code: "",
    href: "/rbac-roles",
    label: "User Roles",
    description: "Manage application user roles.",
    requiredPermission: "user_roles.read",
    matcher: (pathname) => pathname.startsWith("/rbac-roles"),
  },
  {
    code: "",
    href: "/settings/genders",
    label: "Genders",
    description: "Manage gender dropdown values.",
    requiredPermission: "genders.read",
    matcher: (pathname) => pathname.startsWith("/settings/genders"),
  },
  {
    code: "",
    href: "/settings/auth-sessions",
    label: "Auth Sessions",
    description: "Maintain login sessions.",
    requiredPermission: "auth_sessions.read",
    matcher: (pathname) => pathname.startsWith("/settings/auth-sessions"),
  },
  {
    code: "",
    href: "/settings/audit-logs",
    label: "Audit Logs",
    description: "Maintain and inspect audit logs.",
    requiredPermission: "audit_logs.read",
    matcher: (pathname) => pathname.startsWith("/settings/audit-logs"),
  },
];

/** Dashboard card + sidebar row (no permission required). */
export const PORTAL_DASHBOARD_NAV_ITEM: NavItem = {
  code: "D",
  href: "/dashboard",
  label: "Dashboard",
  matcher: (pathname) => pathname === "/" || pathname === "/dashboard",
};

export function getAllPortalDashboardCards(): PortalNavRow[] {
  return [...PORTAL_PRIMARY_MODULES, ...PORTAL_SETTINGS_MODULES];
}

export function filterNavByPermissions(
  items: NavItem[],
  permissions: ReadonlySet<string> | null,
  authReady: boolean,
): NavItem[] {
  return items.filter((item) => {
    if (!item.requiredPermission) {
      return true;
    }

    if (!authReady || permissions === null) {
      return false;
    }

    return permissions.has(item.requiredPermission);
  });
}
