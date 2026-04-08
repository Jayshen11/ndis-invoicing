/**
 * NDIS rate sets — paginated list; create via JSON or multipart (optional Excel on create).
 *
 * **Boundary:** Multipart with file requires `rate_sets.import`; JSON create `rate_sets.write`. Helpers below only parse `FormData` for this route.
 */
import type { NextRequest } from "next/server";
import { requireApiAuth, requirePermission } from "@/lib/api/auth";
import { readJsonRequestBody } from "@/lib/api/request";
import { ApiError } from "@/lib/api/errors";
import { createSuccessResponse, handleRouteError } from "@/lib/api/response";
import {
  createRateSet,
  createRateSetWithExcel,
  listRateSetsPage,
} from "@/services/rate-set.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** `rate_sets.read` — paginated list. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    requirePermission(auth, "rate_sets.read");

    const { data, pagination } = await listRateSetsPage(
      request.nextUrl.searchParams,
    );

    return createSuccessResponse(data, {
      pagination,
    });
  } catch (error) {
    return handleRouteError(
      "Rate set list route failed.",
      error,
      "Failed to load rate sets.",
    );
  }
}

/**
 * Create rate set: JSON body, or `multipart/form-data` with optional `file` (Excel import path).
 * Permissions: `rate_sets.import` if file present; else `rate_sets.write`.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);

    if (isMultipartRequest(request)) {
      const { payload, buffer } = await readRateSetMultipartPayload(request);

      if (buffer !== null) {
        requirePermission(auth, "rate_sets.import");
        const result = await createRateSetWithExcel(payload, buffer);
        return createSuccessResponse(result.rateSet, {
          status: 201,
          meta: {
            importStats: result.importResult.stats,
            parseWarnings: result.importResult.parseWarnings,
          },
        });
      }

      requirePermission(auth, "rate_sets.write");
      const created = await createRateSet(payload);
      return createSuccessResponse(created, { status: 201 });
    }

    requirePermission(auth, "rate_sets.write");
    const payload = await readJsonRequestBody(request);
    const created = await createRateSet(payload);

    return createSuccessResponse(created, { status: 201 });
  } catch (error) {
    return handleRouteError(
      "Rate set create route failed.",
      error,
      "Failed to create rate set.",
    );
  }
}
