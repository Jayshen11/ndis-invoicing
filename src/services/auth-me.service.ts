import {
  getAppUserRowById,
  resolveAuthRbacForAppUserId,
} from "@/repositories/app-user.repository";
import { findActiveAuthSessionById } from "@/repositories/auth-session.repository";
import { isWellFormedSessionId } from "@/lib/auth/session-cookie";
import type { LoginSuccessUser } from "@/services/auth-login.service";

export type AuthMePayload = {
  sessionId: string;
  user: LoginSuccessUser;
  csrfToken: string;
};

/**
 * Resolves the current browser session (cookie id) to user + permissions.
 * `roleId` and `permissions` come from {@link resolveAuthRbacForAppUserId} (live `rbac_user_role` + junction + `rbac_permission`), not `auth_session.role_id`.
 * Returns null when unauthenticated or session invalid (caller maps to 401).
 */
export async function getAuthMePayload(
  sessionIdRaw: string | undefined,
): Promise<AuthMePayload | null> {
  const sessionId = sessionIdRaw?.trim() ?? "";

  if (sessionId === "" || !isWellFormedSessionId(sessionId)) {
    return null;
  }

  const session = await findActiveAuthSessionById(sessionId);

  if (!session) {
    return null;
  }

  const appUser = await getAppUserRowById(session.user_id);

  if (!appUser) {
    return null;
  }

  const rbac = await resolveAuthRbacForAppUserId(appUser.id);

  if (!rbac) {
    return null;
  }

  const permissions = [...rbac.permissionCodes].sort((a, b) =>
    a.localeCompare(b, "en"),
  );

  const user: LoginSuccessUser = {
    id: appUser.id,
    email: appUser.email,
    fullName: appUser.full_name.trim(),
    roleId: rbac.roleId,
    permissions,
  };

  return {
    sessionId,
    user,
    csrfToken: session.csrf_token ?? "",
  };
}
