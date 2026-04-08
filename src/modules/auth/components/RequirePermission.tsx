"use client";

/**
 * Client-side permission gate for **pages and layouts** wrapped in `AuthSessionProvider`.
 *
 * **Purpose:** Avoid flashing protected UI before session/permissions are known, and send users
 * without the right permission to `/unauthorized` (or unauthenticated users to `/login`). Use the
 * same `permission` string codes as `requirePermission` on the matching API routes (e.g. `clients.read`).
 *
 * **Not security:** This is UX only. A user can still call APIs directly; the server must enforce RBAC.
 *
 * @see {@link useAuthSession} — loads `/api/auth/me` and exposes `user.permissions`.
 */
import { useAuthSession } from "@/modules/auth/components/AuthSessionProvider";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef } from "react";

type RequirePermissionProps = Readonly<{
  children: React.ReactNode;
  /** RBAC slug from `rbac_permission.code`; must match list/read API checks for this route. */
  permission: string;
}>;

/** Shown while session is loading or while redirecting (avoids blank flash / wrong content). */
function PermissionGateFallback() {
  return (
    <div
      className="flex min-h-[50vh] w-full items-center justify-center text-slate-500"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
          aria-hidden
        />
        <p className="text-sm">Loading…</p>
      </div>
    </div>
  );
}

/**
 * Renders `children` only when the session is ready **and** `session.user.permissions` includes
 * `permission`. Uses `useLayoutEffect` + `router.replace` so redirects happen before paint when possible.
 *
 * SEC: UX gate only — duplicate checks with `requirePermission` on every API route that mutates data.
 */
export function RequirePermission({
  children,
  permission,
}: RequirePermissionProps) {
  const router = useRouter();
  const { session, isLoading } = useAuthSession();
  const redirectedRef = useRef(false);

  const allowed = useMemo(() => {
    if (!session) {
      return false;
    }

    return session.user.permissions.includes(permission);
  }, [session, permission]);

  useLayoutEffect(() => {
    if (isLoading) {
      return;
    }

    if (!session) {
      if (!redirectedRef.current) {
        redirectedRef.current = true;
        router.replace("/login");
      }

      return;
    }

    if (!allowed) {
      if (!redirectedRef.current) {
        redirectedRef.current = true;
        router.replace("/unauthorized");
      }
    }
  }, [allowed, isLoading, router, session]);

  if (isLoading) {
    return <PermissionGateFallback />;
  }

  if (!session) {
    return <PermissionGateFallback />;
  }

  if (!allowed) {
    return <PermissionGateFallback />;
  }

  return <>{children}</>;
}
