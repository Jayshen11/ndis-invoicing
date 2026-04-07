export const AUDIT_LOG_ACTION_OPTIONS = [
  { value: "app_user.create", label: "Create App User" },
  { value: "auth.create", label: "Create Auth" },
  { value: "auth_session.delete", label: "Delete Auth Session" },
  { value: "auth.password_update", label: "Update Auth Password" },
  { value: "client.create", label: "Create Client" },
  { value: "client.update", label: "Update Client" },
  { value: "client.delete", label: "Delete Client" },
  { value: "gender.create", label: "Create Gender" },
  { value: "gender.update", label: "Update Gender" },
  { value: "gender.delete", label: "Delete Gender" },
  { value: "invoice.create", label: "Create Invoice" },
  { value: "invoice.update", label: "Update Invoice" },
  { value: "invoice.delete", label: "Delete Invoice" },
  { value: "invoice_item.create", label: "Create Invoice Item" },
  { value: "provider.create", label: "Create Provider" },
  { value: "provider.update", label: "Update Provider" },
  { value: "provider.delete", label: "Delete Provider" },
  { value: "rate_set.create", label: "Create Rate Set" },
  { value: "rate_set.update", label: "Update Rate Set" },
  { value: "rate_set.delete", label: "Delete Rate Set" },
  { value: "rate_set.import", label: "Import Rate Set" },
  { value: "rbac_role.update", label: "Update Rbac Role" },
] as const;

export const AUDIT_LOG_ENTITY_OPTIONS = [
  { value: "app_user", label: "App User" },
  { value: "auth", label: "Auth" },
  { value: "auth_session", label: "Auth Session" },
  { value: "client", label: "Client" },
  { value: "gender", label: "Gender" },
  { value: "invoice", label: "Invoice" },
  { value: "invoice_item", label: "Invoice Item" },
  { value: "provider", label: "Provider" },
  { value: "rate_set", label: "Rate Set" },
  { value: "rbac_role", label: "Rbac Role" },
] as const;

export const AUDIT_LOG_PERMISSION_OPTIONS = [
  { value: "auth_sessions.delete", label: "Delete auth sessions" },
  { value: "clients.write", label: "Add or edit clients" },
  { value: "genders.write", label: "Add or edit genders" },
  { value: "invoices.write", label: "Add or edit invoices" },
  { value: "providers.write", label: "Add or edit providers" },
  { value: "rate_sets.write", label: "Add or edit rate sets" },
  { value: "user_roles.write", label: "Add or edit user roles" },
  { value: "users.write", label: "Add or edit users" },
  { value: "clients.delete", label: "Delete clients" },
  { value: "genders.delete", label: "Delete genders" },
  { value: "providers.delete", label: "Delete providers" },
  { value: "rate_sets.delete", label: "Delete rate sets" },
  { value: "rate_sets.import", label: "Import rate sets" },
] as const;

export type AuditLogActionValue = (typeof AUDIT_LOG_ACTION_OPTIONS)[number]["value"];
export type AuditLogEntityValue = (typeof AUDIT_LOG_ENTITY_OPTIONS)[number]["value"];
export type AuditLogPermissionValue =
  (typeof AUDIT_LOG_PERMISSION_OPTIONS)[number]["value"];

export type AuditLogOption = {
  value: string;
  label: string;
};

export type AuditLogChangeDiff = Record<
  string,
  {
    before?: unknown;
    after?: unknown;
  }
>;

export type AuditLogRow = {
  id: string;
  actor_user_id: number | null;
  actor_user_label: string | null;
  actor_role_id: number | null;
  actor_role_label: string | null;
  /** Stored action slug; allow string so list API tolerates new actions before catalog updates. */
  action: string;
  action_label: string;
  permission_code: string | null;
  permission_label: string | null;
  entity: string;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  changes_diff: AuditLogChangeDiff | null;
  before: string | null;
  after: string | null;
  created_at: string;
};

export type AuditLogListFilters = {
  user_id?: number;
  role_id?: number;
  action?: AuditLogActionValue;
  permission?: AuditLogPermissionValue;
  entity?: AuditLogEntityValue;
  created_start?: string;
  created_end?: string;
  limit: number;
  offset: number;
};

export type AuditLogListPage = {
  data: AuditLogRow[];
  pagination: { limit: number; offset: number; total: number };
};

export type AuditActor = {
  actor_user_id: number | null;
  actor_user_label: string | null;
  actor_role_id: number | null;
  actor_role_label: string | null;
};

export type AuditLogInsertInput = AuditActor & {
  action: AuditLogActionValue;
  action_label: string;
  permission_code: AuditLogPermissionValue | null;
  permission_label: string | null;
  entity: AuditLogEntityValue;
  entity_label: string;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  changes_diff: AuditLogChangeDiff | null;
  before: string | null;
  after: string | null;
};
