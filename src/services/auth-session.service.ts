import { ApiError } from "@/lib/api/errors";
import type {
  AuthSessionListFilters,
  AuthSessionListRow,
} from "@/modules/auth-session/types";
import {
  countAuthSessionRows,
  deleteAuthSessionById,
  listAuthSessionRows,
  revokeAuthSessionById,
} from "@/repositories/auth-session.repository";
import { recordAuditEvent } from "@/services/audit-log.service";

const USER_SEARCH_MAX_LENGTH = 120;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 500;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthSessionListPage = {
  data: AuthSessionListRow[];
  pagination: { limit: number; offset: number; total: number };
};

function parseBoundedIntParam(
  raw: string | null,
  field: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === null || raw.trim() === "") {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field,
        message:
          field === "limit"
            ? `Must be an integer between ${min} and ${max}.`
            : "Must be a non-negative integer.",
      },
    ]);
  }

  return value;
}

function parseOptionalIsoDate(
  raw: string | null,
  field: string,
): string | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }

  const trimmed = raw.trim();

  if (!ISO_DATE_RE.test(trimmed)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field,
        message: "Must be a calendar date in YYYY-MM-DD format.",
      },
    ]);
  }

  return trimmed;
}

export function parseAuthSessionListFilters(
  searchParams: URLSearchParams,
): AuthSessionListFilters {
  const rawUser =
    searchParams.get("user")?.trim() ??
    searchParams.get("search")?.trim() ??
    "";

  if (rawUser.length > USER_SEARCH_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "user",
        message: `Must be ${USER_SEARCH_MAX_LENGTH} characters or fewer.`,
      },
    ]);
  }

  const rawUserId = searchParams.get("user_id")?.trim() ?? "";
  let userId: number | null = null;

  if (rawUserId !== "" && rawUserId !== "all") {
    const parsedUserId = Number.parseInt(rawUserId, 10);

    if (!Number.isInteger(parsedUserId) || parsedUserId < 1) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "user_id",
          message: "Must be a positive integer when provided.",
        },
      ]);
    }

    userId = parsedUserId;
  }

  const rawRoleId = searchParams.get("role_id")?.trim() ?? "";
  let roleId: number | null = null;

  if (rawRoleId !== "" && rawRoleId !== "all") {
    const parsed = Number.parseInt(rawRoleId, 10);

    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
        {
          field: "role_id",
          message: "Must be a positive integer when provided.",
        },
      ]);
    }

    roleId = parsed;
  }

  const limit = parseBoundedIntParam(
    searchParams.get("limit"),
    "limit",
    DEFAULT_LIST_LIMIT,
    1,
    MAX_LIST_LIMIT,
  );

  const offset = parseBoundedIntParam(
    searchParams.get("offset"),
    "offset",
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  return {
    userId,
    userSearch: rawUser,
    roleId,
    expiresStart: parseOptionalIsoDate(
      searchParams.get("expires_start"),
      "expires_start",
    ),
    expiresEnd: parseOptionalIsoDate(
      searchParams.get("expires_end"),
      "expires_end",
    ),
    revokedStart: parseOptionalIsoDate(
      searchParams.get("revoked_start"),
      "revoked_start",
    ),
    revokedEnd: parseOptionalIsoDate(
      searchParams.get("revoked_end"),
      "revoked_end",
    ),
    createdStart: parseOptionalIsoDate(
      searchParams.get("created_start"),
      "created_start",
    ),
    createdEnd: parseOptionalIsoDate(
      searchParams.get("created_end"),
      "created_end",
    ),
    limit,
    offset,
  };
}

export async function listAuthSessionsPage(
  searchParams: URLSearchParams,
): Promise<AuthSessionListPage> {
  const filters = parseAuthSessionListFilters(searchParams);

  const [total, rows] = await Promise.all([
    countAuthSessionRows(filters),
    listAuthSessionRows(filters),
  ]);

  return {
    data: rows,
    pagination: {
      limit: filters.limit,
      offset: filters.offset,
      total,
    },
  };
}

function parseSessionIdParam(raw: string): string {
  const trimmed = raw.trim();

  if (!SESSION_ID_RE.test(trimmed)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      { field: "id", message: "Invalid session id." },
    ]);
  }

  return trimmed;
}

export async function revokeAuthSession(
  sessionIdRaw: string,
): Promise<AuthSessionListRow> {
  const sessionId = parseSessionIdParam(sessionIdRaw);
  const row = await revokeAuthSessionById(sessionId);

  if (!row) {
    throw new ApiError(
      404,
      "NOT_FOUND",
      "Session not found or already revoked.",
    );
  }

  return row;
}

export async function deleteAuthSession(sessionIdRaw: string): Promise<void> {
  const sessionId = parseSessionIdParam(sessionIdRaw);
  const removed = await deleteAuthSessionById(sessionId);

  if (!removed) {
    throw new ApiError(404, "NOT_FOUND", "Session not found.");
  }

  await recordAuditEvent({
    action: "auth_session.delete",
    entity: "auth_session",
    permission: "auth_sessions.delete",
    entityId: sessionId,
    before: null,
    after: null,
  });
}
