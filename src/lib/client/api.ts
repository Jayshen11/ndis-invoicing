import type { AppUserApiRecord } from "@/modules/app-user/types";
import type {
  NdisExcelImportApiResult,
  RateSetDateGapCheckResponse,
  RateSetDateOverlapCheckResponse,
} from "@/modules/rate-set/types";
import type { RbacPermissionApiRow } from "@/modules/user-role/permissions-catalog";

export type ApiRequestErrorDetail = {
  field?: string;
  message: string;
};

export type FieldErrors<TField extends string> = Partial<
  Record<TField | "form", string>
>;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: ApiRequestErrorDetail[],
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function getRequestErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallbackMessage;
}

export function getRequestFieldErrors<TField extends string>(
  error: unknown,
): FieldErrors<TField> {
  if (!(error instanceof ApiRequestError) || !error.details) {
    return {};
  }

  const nextErrors: FieldErrors<TField> = {};

  for (const detail of error.details) {
    if (!detail.field) {
      nextErrors.form = detail.message;
      continue;
    }

    nextErrors[detail.field as TField] = detail.message;
  }

  return nextErrors;
}

type ApiJsonPayload = {
  data?: unknown;
  pagination?: unknown;
  meta?: unknown;
  generatedPassword?: unknown;
  successMessage?: unknown;
  error?: {
    code: string;
    message: string;
    details?: ApiRequestErrorDetail[];
  };
};

export async function readApiJsonEnvelope(
  response: Response,
): Promise<ApiJsonPayload | undefined> {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as ApiJsonPayload;
  } catch {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }
}

/** Browser-only: on 403 from app APIs, go to the static not-authorised page. */
function navigateToUnauthorizedIfForbidden(
  apiPathname: string,
  status: number,
): void {
  if (status !== 403) {
    return;
  }
  const browserWindow = globalThis.window;
  if (browserWindow === undefined) {
    return;
  }
  const currentPath = browserWindow.location.pathname;
  if (currentPath === "/unauthorized" || currentPath === "/login") {
    return;
  }

  const path = (apiPathname.split("?")[0] ?? "").trim() || "/";
  // SEC: do not hijack auth flows or /me (layout uses it while deciding redirects).
  if (
    path === "/api/auth/me" ||
    path.startsWith("/api/auth/login") ||
    path.startsWith("/api/auth/logout") ||
    path.startsWith("/api/auth/change-password")
  ) {
    return;
  }

  browserWindow.location.assign("/unauthorized");
}

function resolveRequestInfoPathname(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    if (input.startsWith("/")) {
      return input.split("?")[0] ?? input;
    }
    try {
      return new URL(
        input,
        globalThis.window === undefined
          ? "http://localhost"
          : globalThis.window.location.origin,
      ).pathname;
    } catch {
      return input.split("?")[0] ?? "";
    }
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  try {
    return new URL(input.url).pathname;
  } catch {
    return "";
  }
}

function throwFailedApiResponse(
  response: Response,
  payload: ApiJsonPayload | undefined,
  apiPathname: string,
  redirectOnForbidden = true,
): never {
  if (redirectOnForbidden) {
    navigateToUnauthorizedIfForbidden(apiPathname, response.status);
  }

  throw new ApiRequestError(
    payload?.error?.message ?? "Request failed.",
    response.status,
    payload?.error?.code ?? "REQUEST_FAILED",
    payload?.error?.details,
  );
}

export type GenderCodeExistsResponse = {
  exists: boolean;
};

export type InvoiceNumberExistsResponse = {
  exists: boolean;
};

/** GET /api/rbac-permissions — flat catalog (DB when seeded, else same shape from server catalog). */
export async function fetchRbacPermissions(): Promise<RbacPermissionApiRow[]> {
  return fetchApiData<RbacPermissionApiRow[]>("/api/rbac-permissions");
}

/** GET /api/genders/check-code — body is `{ exists }` only (no `data` envelope). */
export async function fetchGenderCodeExists(
  searchParams: URLSearchParams,
): Promise<GenderCodeExistsResponse> {
  const response = await fetch(
    `/api/genders/check-code?${searchParams.toString()}`,
    { cache: "no-store" },
  );

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(response, payload, "/api/genders/check-code");
  }

  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;

  if (record === null || typeof record.exists !== "boolean") {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return { exists: record.exists };
}

/** GET /api/app-users/check-email — body is `{ exists }` only (no `data` envelope). */
export async function fetchAppUserEmailExists(
  searchParams: URLSearchParams,
): Promise<GenderCodeExistsResponse> {
  const response = await fetch(
    `/api/app-users/check-email?${searchParams.toString()}`,
    { cache: "no-store" },
  );

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(response, payload, "/api/app-users/check-email");
  }

  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;

  if (record === null || typeof record.exists !== "boolean") {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return { exists: record.exists };
}

/** GET /api/rbac-roles/check-code — body is `{ exists }` only (no `data` envelope). */
export async function fetchUserRoleCodeExists(
  searchParams: URLSearchParams,
): Promise<GenderCodeExistsResponse> {
  const response = await fetch(
    `/api/rbac-roles/check-code?${searchParams.toString()}`,
    { cache: "no-store" },
  );

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(response, payload, "/api/rbac-roles/check-code");
  }

  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;

  if (record === null || typeof record.exists !== "boolean") {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return { exists: record.exists };
}

/** GET /api/invoices/check-invoice-number — body is `{ exists }` only (no `data` envelope). */
export async function fetchInvoiceNumberExists(
  searchParams: URLSearchParams,
): Promise<InvoiceNumberExistsResponse> {
  const response = await fetch(
    `/api/invoices/check-invoice-number?${searchParams.toString()}`,
    { cache: "no-store" },
  );

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(response, payload, "/api/invoices/check-invoice-number");
  }

  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;

  if (record === null || typeof record.exists !== "boolean") {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return { exists: record.exists };
}

export async function fetchRateSetDateOverlapCheck(
  searchParams: URLSearchParams,
): Promise<RateSetDateOverlapCheckResponse> {
  const response = await fetch(
    `/api/rate-sets/check-date-overlap?${searchParams.toString()}`,
    { cache: "no-store" },
  );

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(response, payload, "/api/rate-sets/check-date-overlap");
  }

  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;

  if (
    record === null ||
    typeof record.exists !== "boolean" ||
    !Array.isArray(record.overlaps)
  ) {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return {
    exists: record.exists,
    overlaps: record.overlaps.filter(
      (value): value is string => typeof value === "string",
    ),
  };
}

export async function fetchRateSetDateGapCheck(
  searchParams: URLSearchParams,
): Promise<RateSetDateGapCheckResponse> {
  const response = await fetch(
    `/api/rate-sets/check-date-gap?${searchParams.toString()}`,
    { cache: "no-store" },
  );

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(response, payload, "/api/rate-sets/check-date-gap");
  }

  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;

  if (
    record === null ||
    typeof record.hasGap !== "boolean" ||
    !Array.isArray(record.adjacent)
  ) {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return {
    hasGap: record.hasGap,
    adjacent: record.adjacent.filter(
      (value): value is string => typeof value === "string",
    ),
  };
}

export type AppUserCreateResponse = {
  user: AppUserApiRecord;
  generatedPassword: string | null;
  successMessage: string;
};

/** POST /api/app-users — body may include `generatedPassword` when the server generated a login password. */
export async function fetchAppUserCreate(
  body: Record<string, unknown>,
): Promise<AppUserCreateResponse> {
  const response = await fetch("/api/app-users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
  });

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(response, payload, "/api/app-users");
  }

  if (
    payload?.data === undefined ||
    typeof payload.successMessage !== "string"
  ) {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  const generatedPassword =
    typeof payload.generatedPassword === "string"
      ? payload.generatedPassword
      : null;

  return {
    user: payload.data as AppUserApiRecord,
    generatedPassword,
    successMessage: payload.successMessage,
  };
}

export type FetchApiDataConfig = {
  /**
   * When false, a 403 response does not send the browser to `/unauthorized`.
   * SEC: use only for optional supplementary requests where the caller degrades without data.
   */
  redirectOnForbidden?: boolean;
};

export async function fetchApiData<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  config: FetchApiDataConfig = {},
): Promise<T> {
  const headers = new Headers(init?.headers);
  const isFormDataBody =
    typeof FormData !== "undefined" && init?.body instanceof FormData;

  if (init?.body && !isFormDataBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestPath = resolveRequestInfoPathname(input);

  const response = await fetch(input, {
    ...init,
    headers,
    cache: "no-store",
    credentials: init?.credentials ?? "include",
  });

  // Many APIs use 204 No Content for DELETE; allow success without a JSON body.
  if (response.status === 204 || response.status === 205) {
    if (!response.ok) {
      if (config.redirectOnForbidden !== false) {
        navigateToUnauthorizedIfForbidden(requestPath, response.status);
      }

      throw new ApiRequestError(
        "Request failed.",
        response.status,
        "REQUEST_FAILED",
      );
    }

    return undefined as T;
  }

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(
      response,
      payload,
      requestPath,
      config.redirectOnForbidden !== false,
    );
  }

  if (payload?.data === undefined) {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return payload.data as T;
}

/** GET /api/auth/me — session cookie; returns null if not signed in or request fails. */
export type AuthMeSessionData = {
  sessionId: string;
  user: {
    id: number;
    email: string;
    fullName: string;
    roleId: number;
    permissions: string[];
  };
  csrfToken: string;
};

export async function fetchAuthMeSession(): Promise<AuthMeSessionData | null> {
  try {
    return await fetchApiData<AuthMeSessionData>("/api/auth/me", {
      credentials: "include",
    });
  } catch {
    return null;
  }
}

/** POST /api/rate-sets/[id]/import-excel — multipart field `file` (NDIS pricing .xlsx). */
export async function importRateSetNdisExcel(
  rateSetId: number,
  file: File,
): Promise<NdisExcelImportApiResult> {
  const body = new FormData();

  body.set("file", file);

  const importPath = `/api/rate-sets/${rateSetId}/import-excel`;

  const response = await fetch(importPath, {
    method: "POST",
    body,
    cache: "no-store",
    credentials: "include",
  });

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(response, payload, importPath);
  }

  if (payload?.data === undefined) {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return payload.data as NdisExcelImportApiResult;
}

export type ApiListPagination = {
  limit: number;
  offset: number;
  total: number;
};

function isValidPagination(value: unknown): value is ApiListPagination {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.limit === "number" &&
    Number.isInteger(record.limit) &&
    typeof record.offset === "number" &&
    Number.isInteger(record.offset) &&
    typeof record.total === "number" &&
    Number.isInteger(record.total)
  );
}

/** For GET list routes that return `{ data: T[], pagination }` at the top level. */
export async function fetchApiListWithPagination<TItem>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ data: TItem[]; pagination: ApiListPagination }> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestPath = resolveRequestInfoPathname(input);

  const response = await fetch(input, {
    ...init,
    headers,
    cache: "no-store",
    credentials: init?.credentials ?? "include",
  });

  const payload = await readApiJsonEnvelope(response);

  if (!response.ok) {
    throwFailedApiResponse(response, payload, requestPath);
  }

  if (!Array.isArray(payload?.data)) {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  if (!isValidPagination(payload.pagination)) {
    throw new ApiRequestError(
      "Server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return {
    data: payload.data as TItem[],
    pagination: payload.pagination,
  };
}
