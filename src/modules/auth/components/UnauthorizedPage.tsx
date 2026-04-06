"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function UnauthorizedPage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) {
      return;
    }

    setSigningOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
    } catch {
      // SEC: Still navigate; cookie may clear on next full load.
    }

    router.push("/login");
    router.refresh();
    setSigningOut(false);
  }

  return (
    <div className="flex min-h-dvh min-h-screen w-full flex-col items-center justify-center bg-[#f5f7fb] px-4 py-10 sm:px-8">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-md sm:p-10">
        <div className="flex justify-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700"
            aria-hidden
          >
            <svg
              className="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        </div>

        <h1 className="mt-6 text-center text-2xl font-bold tracking-tight text-slate-900">
          You’re not authorised
        </h1>
        <p className="mt-3 text-center text-sm leading-relaxed text-slate-600">
          You don’t have permission to view or use this part of the portal. If you
          think this is a mistake, contact your administrator.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard"
            className="inline-flex justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Return to dashboard
          </Link>
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
            className="inline-flex justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">
          Error code: access denied (403)
        </p>
      </div>
    </div>
  );
}
