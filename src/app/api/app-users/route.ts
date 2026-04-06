import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import {
  createSuccessResponse,
  handleRouteError,
  RESPONSE_HEADERS,
} from "@/lib/api/response";
import { createAppUser, listAppUsersPage } from "@/services/app-user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "users.read");

    const { data, pagination } = await listAppUsersPage(
      request.nextUrl.searchParams,
    );

    return createSuccessResponse(data, {
      pagination,
    });
  } catch (error) {
    return handleRouteError(
      "App user list route failed.",
      error,
      "Failed to load users.",
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "users.write");

    const payload = await readJsonRequestBody(request);
    const result = await createAppUser(payload);

    return NextResponse.json(
      {
        data: result.user,
        ...(result.generatedPassword !== null
          ? { generatedPassword: result.generatedPassword }
          : {}),
        successMessage: result.successMessage,
      },
      { status: 201, headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    return handleRouteError(
      "App user create route failed.",
      error,
      "Failed to create user.",
    );
  }
}
