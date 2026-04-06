export type NavItem = {
  code: string;
  href?: string;
  label: string;
  matcher?: (pathname: string) => boolean;
  /** When set, the link is shown only if the user has this `rbac_permission.code`. */
  requiredPermission?: string;
};
