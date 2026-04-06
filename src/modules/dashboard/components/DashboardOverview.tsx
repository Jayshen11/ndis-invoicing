"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuthSession } from "@/modules/auth/components/AuthSessionProvider";
import { getAllPortalDashboardCards } from "@/modules/dashboard/portal-nav";

export function DashboardOverview() {
  const { session, isLoading } = useAuthSession();
  const authReady = !isLoading && session !== null;
  const permissionSet = useMemo(
    () => (session ? new Set(session.user.permissions) : null),
    [session],
  );

  const visibleCards = useMemo(() => {
    return getAllPortalDashboardCards().filter((card) => {
      if (!authReady || permissionSet === null) {
        return false;
      }

      return permissionSet.has(card.requiredPermission);
    });
  }, [authReady, permissionSet]);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <section className="rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          My NDIS Portal
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Use the cards below to access the modules available to your account.
        </p>
      </section>

      <section className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {!authReady ? (
          <div className="col-span-full flex min-h-[12rem] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-sm text-slate-500">
            Loading modules…
          </div>
        ) : visibleCards.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-600">
            No application modules are assigned to your role. Contact an
            administrator if you need access.
          </div>
        ) : (
          visibleCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-blue-200"
            >
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900 transition group-hover:text-blue-600">
                  {card.label}
                </h2>
              </div>
              <div className="px-5 py-5">
                <p className="text-sm leading-6 text-slate-500">
                  {card.description}
                </p>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
