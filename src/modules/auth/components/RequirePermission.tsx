"use client";

import { useAuthSession } from "@/modules/auth/components/AuthSessionProvider";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef } from "react";

type RequirePermissionProps = Readonly<{
  children: React.ReactNode;
  /** RBAC slug from `rbac_permission.code`; must match list/read API checks for this route. */
  permission: string;
}>;

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
 * Waits for `/api/auth/me` (via {@link useAuthSession}), then renders `children` only if the user
 * has `permission`. Otherwise redirects to `/unauthorized` (or `/login` if there is no session).
 * SEC: UX gate only; APIs remain the source of truth for AuthZ.
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
