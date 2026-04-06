import { NextResponse } from "next/server";
import { ApiError, isApiError } from "@/lib/api/errors";

export const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

type ResponseMeta = Record<string, unknown>;

export type ApiPagination = {
  limit: number;
  offset: number;
  total: number;
};

export function createSuccessResponse<T>(
  data: T,
  options: {
    meta?: ResponseMeta;
    status?: number;
    pagination?: ApiPagination;
  } = {},
) {
  return NextResponse.json(
    {
      data,
      ...(options.meta ? { meta: options.meta } : {}),
      ...(options.pagination ? { pagination: options.pagination } : {}),
    },
    {
      status: options.status ?? 200,
      headers: RESPONSE_HEADERS,
    },
  );
}

export function createErrorResponse(error: ApiError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    },
    {
      status: error.status,
      headers: RESPONSE_HEADERS,
    },
  );
}

export function handleRouteError(
  logMessage: string,
  error: unknown,
  fallbackMessage: string,
) {
  if (isApiError(error)) {
    if (error.status >= 500) {
      console.error(logMessage, error);
    }

    return createErrorResponse(error);
  }

  // SEC: Keep raw exception details on the server while returning a generic client response.
  console.error(logMessage, error);

  return createErrorResponse(
    new ApiError(500, "INTERNAL_ERROR", fallbackMessage),
  );
}
