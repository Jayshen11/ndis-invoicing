import argon2 from "argon2";
import { ApiError, type ApiErrorDetail } from "@/lib/api/errors";
import {
  findAppUserLoginCredentialByEmail,
  getAppUserRowById,
  resolveAuthRbacForAppUserId,
} from "@/repositories/app-user.repository";
import { insertAuthSessionRow } from "@/repositories/auth-session.repository";

const EMAIL_MAX = 254;
const PASSWORD_MAX = 128;

const DEFAULT_SESSION_SECONDS = 60 * 60 * 24;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionMaxAgeSeconds(): number {
  const raw = process.env.AUTH_SESSION_MAX_AGE_SEC?.trim();

  if (!raw) {
    return DEFAULT_SESSION_SECONDS;
  }

  const n = Number.parseInt(raw, 10);

  if (!Number.isInteger(n) || n < 60 || n > 60 * 60 * 24 * 30) {
    return DEFAULT_SESSION_SECONDS;
  }

  return n;
}

export type LoginRequestMeta = {
  userAgent: string;
  ip: string;
};

/** Gateway-shaped user payload returned on successful login (camelCase). */
export type LoginSuccessUser = {
  id: number;
  email: string;
  fullName: string;
  roleId: number;
  permissions: string[];
};

/**
 * SEC: Verifies email/password and creates `auth_session`. Returns session id (cookie + body),
 * CSRF token, and user with permission slugs. Generic errors on failure to reduce enumeration.
 */
export async function loginWithEmailPassword(
  payload: unknown,
  meta: LoginRequestMeta,
): Promise<{
  sessionId: string;
  csrfToken: string;
  user: LoginSuccessUser;
}> {
  if (!isPlainObject(payload)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object.");
  }

  const details: ApiErrorDetail[] = [];
  const emailRaw = payload.email;
  const passwordRaw = payload.password;

  if (typeof emailRaw !== "string" || emailRaw.trim() === "") {
    details.push({ field: "email", message: "This field is required." });
  } else if (emailRaw.trim().length > EMAIL_MAX) {
    details.push({
      field: "email",
      message: `Must be ${EMAIL_MAX} characters or fewer.`,
    });
  }

  if (typeof passwordRaw !== "string" || passwordRaw === "") {
    details.push({ field: "password", message: "This field is required." });
  } else if (passwordRaw.length > PASSWORD_MAX) {
    details.push({
      field: "password",
      message: `Must be ${PASSWORD_MAX} characters or fewer.`,
    });
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  const email = (emailRaw as string).trim();
  const password = passwordRaw as string;

  const row = await findAppUserLoginCredentialByEmail(email);

  if (!row) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  try {
    const ok = await argon2.verify(row.password_hash, password);

    if (!ok) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    console.error("auth-login: argon2.verify failed", error);
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const appUser = await getAppUserRowById(row.user_id);

  if (!appUser) {
    console.error("auth-login: app_user missing after credential match", row.user_id);
    throw new ApiError(500, "INTERNAL_ERROR", "Sign in failed. Try again later.");
  }

  const rbac = await resolveAuthRbacForAppUserId(row.user_id);

  if (!rbac) {
    console.error(
      "auth-login: rbac assignment missing or invalid for user",
      row.user_id,
    );
    throw new ApiError(500, "INTERNAL_ERROR", "Sign in failed. Try again later.");
  }

  const maxAgeSec = parseSessionMaxAgeSeconds();
  const expiresAt = new Date(Date.now() + maxAgeSec * 1000);

  const { id: sessionId, csrfToken } = await insertAuthSessionRow({
    userId: row.user_id,
    roleId: rbac.roleId,
    userAgent: meta.userAgent.slice(0, 2000),
    ip: meta.ip.slice(0, 200),
    expiresAt,
  });

  const permissions = [...rbac.permissionCodes].sort((a, b) =>
    a.localeCompare(b, "en"),
  );

  return {
    sessionId,
    csrfToken,
    user: {
      id: appUser.id,
      email: appUser.email,
      fullName: appUser.full_name.trim(),
      roleId: rbac.roleId,
      permissions,
    },
  };
}
