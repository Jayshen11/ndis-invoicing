/**
 * Clears session cookie and best-effort revokes current session id in DB.
 *
 * **Boundary:** Always 200 `{ success: true }` after clearing cookie; revoke errors logged only.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  isWellFormedSessionId,
  NDIS_SESSION_COOKIE_NAME,
} from "@/lib/auth/session-cookie";
import { RESPONSE_HEADERS } from "@/lib/api/response";
import { revokeAuthSessionById } from "@/repositories/auth-session.repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appendClearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: NDIS_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Idempotent-friendly: clears cookie even if session id missing or revoke fails. */
export async function POST(request: NextRequest) {
  const raw = request.cookies.get(NDIS_SESSION_COOKIE_NAME)?.value?.trim() ?? "";

  const response = NextResponse.json(
    { success: true },
    { status: 200, headers: RESPONSE_HEADERS },
  );

  appendClearSessionCookie(response);

  if (isWellFormedSessionId(raw)) {
    try {
      await revokeAuthSessionById(raw);
    } catch (error) {
      console.error("Auth logout revoke failed.", error);
    }
  }

  return response;
}
