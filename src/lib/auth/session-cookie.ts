/** HttpOnly cookie storing `auth_session.id` (UUID). */
export const NDIS_SESSION_COOKIE_NAME = "ndis_session";

// SEC: Only pass well-formed UUIDs to the DB layer for session id.
export const SESSION_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWellFormedSessionId(value: string): boolean {
  return SESSION_ID_UUID_RE.test(value.trim());
}
