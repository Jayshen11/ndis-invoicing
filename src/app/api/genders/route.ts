import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import {
  createSuccessResponse,
  handleRouteError,
} from "@/lib/api/response";
import { createGender, listGendersPage } from "@/services/gender.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "genders.read");

    const { data, pagination } = await listGendersPage(
      request.nextUrl.searchParams,
    );

    return createSuccessResponse(data, {
      pagination,
    });
  } catch (error) {
    return handleRouteError(
      "Gender list route failed.",
      error,
      "Failed to load genders.",
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "genders.write");

    const payload = await readJsonRequestBody(request);
    const row = await createGender(payload);

    return createSuccessResponse(row, {
      status: 201,
    });
  } catch (error) {
    return handleRouteError(
      "Gender create route failed.",
      error,
      "Failed to create gender.",
    );
  }
}
