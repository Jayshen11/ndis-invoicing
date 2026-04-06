import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import { ApiError } from "@/lib/api/errors";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import {
  deleteRateSet,
  getRateSet,
  updateRateSet,
  updateRateSetWithExcel,
} from "@/services/rate-set.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

function isMultipartRequest(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("multipart/form-data");
}

async function readRateSetMultipartPayload(request: NextRequest): Promise<{
  payload: Record<string, unknown>;
  buffer: Buffer | null;
}> {
  const formData = await request.formData();
  const file = formData.get("file");

  const payload: Record<string, unknown> = {
    name: formData.get("name"),
    description: formData.get("description"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    active: formData.get("active"),
  };

  if (!(file instanceof File) || file.size === 0) {
    return { payload, buffer: null };
  }

  const mime = (file.type ?? "").trim().toLowerCase();

  if (mime !== "" && !ALLOWED_MIME.has(mime)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", [
      {
        field: "file",
        message: "Only Excel workbooks (.xlsx / .xls) are allowed.",
      },
    ]);
  }

  return {
    payload,
    buffer: Buffer.from(await file.arrayBuffer()),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "rate_sets.read");

    const { id } = await context.params;
    const result = await getRateSet(id);

    return createSuccessResponse(result, { status: 200 });
  } catch (error) {
    return handleRouteError(
      "Rate set detail route failed.",
      error,
      "Failed to load rate set.",
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);

    const { id } = await context.params;

    if (isMultipartRequest(request)) {
      const { payload, buffer } = await readRateSetMultipartPayload(request);

      if (buffer !== null) {
        requirePermission(auth, "rate_sets.import");
        const result = await updateRateSetWithExcel(id, payload, buffer);
        return createSuccessResponse(result.rateSet, {
          status: 200,
          meta: {
            importStats: result.importResult.stats,
            parseWarnings: result.importResult.parseWarnings,
          },
        });
      }

      requirePermission(auth, "rate_sets.write");
      const result = await updateRateSet(id, payload);
      return createSuccessResponse(result, { status: 200 });
    }

    requirePermission(auth, "rate_sets.write");
    const payload = await readJsonRequestBody(request);
    const result = await updateRateSet(id, payload);

    return createSuccessResponse(result, { status: 200 });
  } catch (error) {
    return handleRouteError(
      "Rate set update route failed.",
      error,
      "Failed to update rate set.",
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "rate_sets.delete");

    const { id } = await context.params;
    const result = await deleteRateSet(id);

    return createSuccessResponse(result, { status: 200 });
  } catch (error) {
    return handleRouteError(
      "Rate set delete route failed.",
      error,
      "Failed to delete rate set.",
    );
  }
}
