/** Row from `GET /api/auth-sessions` (joined labels). */
export type AuthSessionListRow = {
  id: string;
  user_id: number;
  role_id: number;
  user_agent: string;
  ip: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  user_label: string;
  role_label: string;
};

export type AuthSessionListFilters = {
  /** When set, restricts to this app user (precise filter). */
  userId: number | null;
  userSearch: string;
  roleId: number | null;
  expiresStart: string | null;
  expiresEnd: string | null;
  revokedStart: string | null;
  revokedEnd: string | null;
  createdStart: string | null;
  createdEnd: string | null;
  limit: number;
  offset: number;
};
