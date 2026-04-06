import argon2 from "argon2";
import { ApiError, type ApiErrorDetail } from "@/lib/api/errors";
import {
  findAppUserPasswordHashByUserId,
  upsertAuthPasswordHashForUser,
} from "@/repositories/app-user.repository";
import { recordAuditEvent } from "@/services/audit-log.service";

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnField(
  object: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * SEC: Session user only — verifies current password, then stores Argon2id hash.
 */
export async function changePasswordForSessionUser(
  userId: number,
  payload: unknown,
): Promise<void> {
  if (!isPlainObject(payload)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object.");
  }

  const details: ApiErrorDetail[] = [];

  for (const fieldName of Object.keys(payload)) {
    if (
      fieldName !== "current_password" &&
      fieldName !== "password"
    ) {
      details.push({
        field: fieldName,
        message: "Unsupported field.",
      });
    }
  }

  const currentRaw = hasOwnField(payload, "current_password")
    ? payload.current_password
    : undefined;
  const nextRaw = hasOwnField(payload, "password")
    ? payload.password
    : undefined;

  if (typeof currentRaw !== "string" || currentRaw === "") {
    details.push({
      field: "current_password",
      message: "This field is required.",
    });
  } else if (currentRaw.length > PASSWORD_MAX) {
    details.push({
      field: "current_password",
      message: `Must be ${PASSWORD_MAX} characters or fewer.`,
    });
  }

  if (typeof nextRaw !== "string" || nextRaw.trim() === "") {
    details.push({
      field: "password",
      message: "This field is required.",
    });
  } else if (nextRaw.length > PASSWORD_MAX) {
    details.push({
      field: "password",
      message: `Must be ${PASSWORD_MAX} characters or fewer.`,
    });
  } else if (nextRaw.length < PASSWORD_MIN) {
    details.push({
      field: "password",
      message: `Must be at least ${PASSWORD_MIN} characters.`,
    });
  }

  if (details.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed.", details);
  }

  const currentPassword = currentRaw as string;
  const newPassword = (nextRaw as string).trim();

  const row = await findAppUserPasswordHashByUserId(userId);

  if (!row) {
    throw new ApiError(
      400,
      "PASSWORD_NOT_SET",
      "No password is set for this account.",
    );
  }

  try {
    const ok = await argon2.verify(row.password_hash, currentPassword);

    if (!ok) {
      throw new ApiError(
        400,
        "INVALID_CURRENT_PASSWORD",
        "Current password is incorrect.",
        [
          {
            field: "current_password",
            message: "Current password is incorrect.",
          },
        ],
      );
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    console.error("auth-change-password: argon2.verify failed", error);
    throw new ApiError(
      400,
      "INVALID_CURRENT_PASSWORD",
      "Current password is incorrect.",
      [
        {
          field: "current_password",
          message: "Current password is incorrect.",
        },
      ],
    );
  }

  let newHash: string;

  try {
    newHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  } catch (hashError) {
    console.error("auth-change-password: argon2.hash failed", hashError);
    throw new ApiError(
      500,
      "PASSWORD_HASH_FAILED",
      "Could not process the new password. Try again.",
    );
  }

  await upsertAuthPasswordHashForUser(userId, newHash);

  await recordAuditEvent({
    action: "auth.password_update",
    entity: "auth",
    entityId: userId,
  });
}
