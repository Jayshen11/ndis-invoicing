"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AppUserOptionRow } from "@/modules/app-user/types";
import type { AuthSessionListRow } from "@/modules/auth-session/types";
import type { RbacRoleOptionRow } from "@/modules/user-role/types";
import { fetchApiData, fetchApiListWithPagination, getRequestErrorMessage } from "@/lib/client/api";

const INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

const VIEW_FIELD_CLASS =
  "mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none cursor-default";

const VIEW_SELECT_CLASS =
  "mt-2 w-full cursor-default appearance-none rounded-lg border border-slate-200 bg-slate-50 bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none disabled:opacity-100";

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getFullYear()),
  ];
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];

  return `${parts.join("/")} ${time.join(":")}`;
}

function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function DeleteAuthSessionConfirmPopover({
  busy,
  onCancel,
  onConfirm,
}: Readonly<{
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  return (
    <div
      role="dialog"
      aria-labelledby="delete-auth-session-title"
      aria-describedby="delete-auth-session-desc"
      className="absolute right-0 bottom-full z-20 mb-2 w-[min(calc(100vw-2rem),320px)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
    >
      <div className="flex gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg font-bold leading-none text-amber-600"
          aria-hidden
        >
          !
        </div>
        <div className="min-w-0 flex-1">
          <h3
            id="delete-auth-session-title"
            className="text-base font-semibold text-slate-900"
          >
            Delete Auth Session
          </h3>
          <p
            id="delete-auth-session-desc"
            className="mt-2 text-sm text-slate-600"
          >
            This action cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-rose-400"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyDateTimeField({
  id,
  label,
  required: isRequired,
  value,
  emptyPlaceholder,
}: Readonly<{
  id: string;
  label: string;
  required?: boolean;
  value: string | null;
  emptyPlaceholder: string;
}>) {
  const display =
    value && value.trim() !== "" ? formatDateTime(value) : "";

  return (
    <div>
      <label className="text-sm font-medium text-slate-600" htmlFor={id}>
        {isRequired ? (
          <span className="text-rose-500" aria-hidden>
            *
          </span>
        ) : null}{" "}
        {label}
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type="text"
          readOnly
          value={display}
          placeholder={emptyPlaceholder}
          className={`${VIEW_FIELD_CLASS} pr-10 ${display === "" ? "text-slate-400" : ""}`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
          <CalendarIcon />
        </span>
      </div>
    </div>
  );
}

/** Page indices for prev/next + numbered buttons (ellipsis when many pages). */
function buildAuthSessionPaginationItems(
  totalPages: number,
  currentPage: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 0) {
    return [];
  }

  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | "ellipsis"> = [1];

  if (currentPage > 4) {
    items.push("ellipsis");
  }

  let start = Math.max(2, currentPage - 2);
  let end = Math.min(totalPages - 1, currentPage + 2);

  if (currentPage <= 4) {
    end = Math.min(5, totalPages - 1);
  }

  if (currentPage >= totalPages - 3) {
    start = Math.max(2, totalPages - 4);
  }

  for (let page = start; page <= end; page++) {
    items.push(page);
  }

  if (currentPage < totalPages - 3) {
    items.push("ellipsis");
  }

  if (totalPages > 1) {
    items.push(totalPages);
  }

  return items;
}

function DateRangeField({
  endId,
  endValue,
  heading,
  onEndChange,
  onStartChange,
  startId,
  startValue,
}: Readonly<{
  heading: string;
  startId: string;
  endId: string;
  startValue: string;
  endValue: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}>) {
  return (
    <div className="min-w-[min(100%,280px)] flex-1">
      <span className="text-sm font-medium text-slate-500">{heading}</span>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id={startId}
          type="date"
          value={startValue}
          onChange={(event) => onStartChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
          aria-label={`${heading} start date`}
        />
        <span className="text-slate-400" aria-hidden>
          →
        </span>
        <input
          id={endId}
          type="date"
          value={endValue}
          onChange={(event) => onEndChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
          aria-label={`${heading} end date`}
        />
      </div>
    </div>
  );
}

export function AuthSessionsManager() {
  const [rows, setRows] = useState<AuthSessionListRow[]>([]);
  const [userOptions, setUserOptions] = useState<AppUserOptionRow[]>([]);
  const [roleOptions, setRoleOptions] = useState<RbacRoleOptionRow[]>([]);
  const [userIdFilter, setUserIdFilter] = useState<string>("all");
  const [roleIdFilter, setRoleIdFilter] = useState<string>("all");
  const [expiresStart, setExpiresStart] = useState("");
  const [expiresEnd, setExpiresEnd] = useState("");
  const [revokedStart, setRevokedStart] = useState("");
  const [revokedEnd, setRevokedEnd] = useState("");
  const [createdStart, setCreatedStart] = useState("");
  const [createdEnd, setCreatedEnd] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [viewSession, setViewSession] = useState<AuthSessionListRow | null>(
    null,
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const closeViewSession = useCallback(() => {
    setDeleteConfirmOpen(false);
    setViewSession(null);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    userIdFilter,
    roleIdFilter,
    pageSize,
    expiresStart,
    expiresEnd,
    revokedStart,
    revokedEnd,
    createdStart,
    createdEnd,
  ]);

  const loadFilterOptions = useCallback(async () => {
    setOptionsError(null);

    try {
      const [users, roles] = await Promise.all([
        fetchApiData<AppUserOptionRow[]>("/api/app-users/options"),
        fetchApiData<RbacRoleOptionRow[]>("/api/rbac-roles/options"),
      ]);

      setUserOptions(users);
      setRoleOptions(roles);
    } catch (error) {
      setOptionsError(
        getRequestErrorMessage(error, "Failed to load filter options."),
      );
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String((currentPage - 1) * pageSize));

      if (userIdFilter !== "all") {
        params.set("user_id", userIdFilter);
      }

      if (roleIdFilter !== "all") {
        params.set("role_id", roleIdFilter);
      }

      if (expiresStart) {
        params.set("expires_start", expiresStart);
      }

      if (expiresEnd) {
        params.set("expires_end", expiresEnd);
      }

      if (revokedStart) {
        params.set("revoked_start", revokedStart);
      }

      if (revokedEnd) {
        params.set("revoked_end", revokedEnd);
      }

      if (createdStart) {
        params.set("created_start", createdStart);
      }

      if (createdEnd) {
        params.set("created_end", createdEnd);
      }

      const endpoint = `/api/auth-sessions?${params.toString()}`;
      const { data, pagination } =
        await fetchApiListWithPagination<AuthSessionListRow>(endpoint);

      setRows(data);
      setListTotal(pagination.total);

      const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize));

      setCurrentPage((page) => Math.min(page, totalPages));
    } catch (error) {
      setRows([]);
      setListTotal(0);
      setLoadError(
        getRequestErrorMessage(error, "Failed to load auth sessions."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    pageSize,
    currentPage,
    userIdFilter,
    roleIdFilter,
    expiresStart,
    expiresEnd,
    revokedStart,
    revokedEnd,
    createdStart,
    createdEnd,
  ]);

  useEffect(() => {
    void loadFilterOptions();
  }, [loadFilterOptions]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      setToastMessage(null);
    }, 4000);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [toastMessage]);

  async function performDeleteSession(session: AuthSessionListRow) {
    setRevokingId(session.id);

    try {
      await fetchApiData<undefined>(`/api/auth-sessions/${session.id}`, {
        method: "DELETE",
      });

      setToastMessage("Session deleted.");
      setDeleteConfirmOpen(false);
      closeViewSession();
      await loadSessions();
    } catch (error) {
      setLoadError(
        getRequestErrorMessage(error, "Failed to delete session."),
      );
    } finally {
      setRevokingId(null);
    }
  }

  async function performRevokeFromTable(session: AuthSessionListRow) {
    setRevokingId(session.id);

    try {
      const updated = await fetchApiData<AuthSessionListRow>(
        `/api/auth-sessions/${session.id}/revoke`,
        { method: "POST" },
      );

      setToastMessage("Session revoked.");
      setViewSession((v) => (v?.id === session.id ? updated : v));
      await loadSessions();
    } catch (error) {
      setLoadError(
        getRequestErrorMessage(error, "Failed to revoke session."),
      );
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeFromTable(session: AuthSessionListRow) {
    // SEC: Table row — lightweight confirm (drawer uses template popover).
    const ok = globalThis.confirm(
      `Revoke this session for ${session.user_label}? They will need to sign in again on that device.`,
    );

    if (!ok) {
      return;
    }

    await performRevokeFromTable(session);
  }

  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  return (
    <div className="mx-auto w-full max-w-7xl">
      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed top-6 left-1/2 z-[200] flex max-w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 justify-center px-4"
        >
          <div className="pointer-events-auto rounded-xl border border-white/25 bg-[rgb(18,185,129)] px-5 py-3 text-sm font-medium text-white shadow-lg">
            {toastMessage}
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
            Auth Sessions
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Maintain login sessions.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadSessions()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          {loadError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {loadError}
            </div>
          ) : null}

          {optionsError ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {optionsError}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex flex-wrap gap-4 md:items-end">
              <div className="min-w-[200px] flex-1">
                <label
                  className="text-sm font-medium text-slate-500"
                  htmlFor="authSessionUser"
                >
                  User
                </label>
                <select
                  id="authSessionUser"
                  value={userIdFilter}
                  onChange={(event) => setUserIdFilter(event.target.value)}
                  className={INPUT_CLASS_NAME}
                >
                  <option value="all">All users</option>
                  {userOptions.map((user) => (
                    <option key={user.id} value={String(user.id)}>
                      {user.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-full min-w-[180px] md:w-52">
                <label
                  className="text-sm font-medium text-slate-500"
                  htmlFor="authSessionRole"
                >
                  Role
                </label>
                <select
                  id="authSessionRole"
                  value={roleIdFilter}
                  onChange={(event) => setRoleIdFilter(event.target.value)}
                  className={INPUT_CLASS_NAME}
                >
                  <option value="all">All roles</option>
                  {roleOptions.map((role) => (
                    <option key={role.id} value={String(role.id)}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <DateRangeField
                heading="Expires At"
                startId="expiresStart"
                endId="expiresEnd"
                startValue={expiresStart}
                endValue={expiresEnd}
                onStartChange={setExpiresStart}
                onEndChange={setExpiresEnd}
              />
              <DateRangeField
                heading="Revoked At"
                startId="revokedStart"
                endId="revokedEnd"
                startValue={revokedStart}
                endValue={revokedEnd}
                onStartChange={setRevokedStart}
                onEndChange={setRevokedEnd}
              />
              <DateRangeField
                heading="Created At"
                startId="createdStart"
                endId="createdEnd"
                startValue={createdStart}
                endValue={createdEnd}
                onStartChange={setCreatedStart}
                onEndChange={setCreatedEnd}
              />
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">User</th>
                  <th className="px-3 py-3 font-semibold">Role</th>
                  <th className="px-3 py-3 font-semibold">User Agent</th>
                  <th className="px-3 py-3 font-semibold">IP</th>
                  <th className="px-3 py-3 font-semibold">Expires At</th>
                  <th className="px-3 py-3 font-semibold">Revoked At</th>
                  <th className="px-3 py-3 font-semibold">Created At</th>
                  <th className="px-3 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-10 text-center text-sm text-slate-500"
                    >
                      No sessions found for the current filters.
                    </td>
                  </tr>
                ) : null}

                {rows.map((session) => {
                  const isRevoked = session.revoked_at !== null;
                  const isBusy = revokingId === session.id;

                  return (
                    <tr key={session.id} className="transition hover:bg-slate-50">
                      <td className="px-3 py-4 font-medium text-slate-900">
                        {session.user_label}
                      </td>
                      <td className="px-3 py-4 text-slate-700">
                        {session.role_label}
                      </td>
                      <td
                        className="max-w-xs truncate px-3 py-4 text-slate-600"
                        title={session.user_agent}
                      >
                        {session.user_agent}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 font-mono text-xs text-slate-700">
                        {session.ip}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-slate-700">
                        {formatDateTime(session.expires_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-slate-700">
                        {formatDateTime(session.revoked_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-slate-700">
                        {formatDateTime(session.created_at)}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setViewSession(session)}
                            className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-50"
                          >
                            View
                          </button>
                          {!isRevoked ? (
                            <button
                              type="button"
                              onClick={() => void handleRevokeFromTable(session)}
                              disabled={isBusy}
                              className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isBusy ? "Revoking…" : "Revoke"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <nav
              className="flex flex-wrap items-center gap-1"
              aria-label="Sessions pagination"
            >
              <button
                type="button"
                aria-label="Previous page"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={safePage <= 1 || isLoading}
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border text-sm transition disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-300 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-50"
              >
                {"<"}
              </button>

              {buildAuthSessionPaginationItems(totalPages, safePage).map(
                (item, index, array) =>
                  item === "ellipsis" ? (
                    <span
                      key={`ellipsis-${String(array[index - 1])}-${String(array[index + 1])}`}
                      className="inline-flex min-w-8 items-center justify-center px-1 text-sm text-slate-400"
                      aria-hidden
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      aria-label={`Page ${item}`}
                      aria-current={item === safePage ? "page" : undefined}
                      onClick={() => setCurrentPage(item)}
                      disabled={isLoading}
                      className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border px-3 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        item === safePage
                          ? "border-[#1890ff] font-semibold text-[#1890ff] bg-white"
                          : "border-transparent font-normal text-slate-900 hover:border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {item}
                    </button>
                  ),
              )}

              <button
                type="button"
                aria-label="Next page"
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
                disabled={safePage >= totalPages || isLoading}
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border text-sm transition disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-300 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-50"
              >
                {">"}
              </button>
            </nav>

            <label htmlFor="authSessionPageSize" className="sr-only">
              Rows per page
            </label>
            <select
              id="authSessionPageSize"
              value={String(pageSize)}
              onChange={(event) => setPageSize(Number(event.target.value))}
              disabled={isLoading}
              className="cursor-pointer appearance-none rounded-md border border-slate-200 bg-white py-1.5 pr-8 pl-3 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-[#1890ff] focus:ring-1 focus:ring-[#1890ff] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 0.5rem center",
                backgroundSize: "1rem",
              }}
            >
              <option value="10">10 / page</option>
              <option value="20">20 / page</option>
              <option value="50">50 / page</option>
            </select>
          </div>
        </div>
      </section>

      {viewSession && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[150]" role="presentation">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40"
                aria-label="Close panel"
                onClick={() => closeViewSession()}
              />
              <aside
                role="dialog"
                aria-modal="true"
                aria-labelledby="authSessionViewTitle"
                className="absolute inset-y-0 right-0 z-10 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
              >
                <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                  <button
                    type="button"
                    className="text-xl leading-none text-slate-400 transition hover:text-slate-700"
                    aria-label="Close"
                    onClick={() => closeViewSession()}
                  >
                    ×
                  </button>
                  <h2
                    id="authSessionViewTitle"
                    className="text-lg font-semibold text-slate-900"
                  >
                    View Auth Session
                  </h2>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-6">
                  <div className="space-y-5">
                    <div>
                      <label
                        className="text-sm font-medium text-slate-600"
                        htmlFor="view-auth-session-user"
                      >
                        <span className="text-rose-500" aria-hidden>
                          *
                        </span>{" "}
                        User
                      </label>
                      <select
                        id="view-auth-session-user"
                        disabled
                        value={String(viewSession.user_id)}
                        className={VIEW_SELECT_CLASS}
                        style={{
                          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                        }}
                      >
                        <option value={String(viewSession.user_id)}>
                          {viewSession.user_label}
                        </option>
                      </select>
                    </div>

                    <div>
                      <label
                        className="text-sm font-medium text-slate-600"
                        htmlFor="view-auth-session-role"
                      >
                        <span className="text-rose-500" aria-hidden>
                          *
                        </span>{" "}
                        Role
                      </label>
                      <select
                        id="view-auth-session-role"
                        disabled
                        value={String(viewSession.role_id)}
                        className={VIEW_SELECT_CLASS}
                        style={{
                          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                        }}
                      >
                        <option value={String(viewSession.role_id)}>
                          {viewSession.role_label}
                        </option>
                      </select>
                    </div>

                    <div>
                      <label
                        className="text-sm font-medium text-slate-600"
                        htmlFor="view-auth-session-ua"
                      >
                        User Agent
                      </label>
                      <textarea
                        id="view-auth-session-ua"
                        readOnly
                        rows={3}
                        value={viewSession.user_agent}
                        className={`${VIEW_FIELD_CLASS} resize-none`}
                      />
                    </div>

                    <div>
                      <label
                        className="text-sm font-medium text-slate-600"
                        htmlFor="view-auth-session-ip"
                      >
                        IP
                      </label>
                      <input
                        id="view-auth-session-ip"
                        type="text"
                        readOnly
                        value={viewSession.ip}
                        className={`${VIEW_FIELD_CLASS} font-mono text-xs`}
                      />
                    </div>

                    <ReadOnlyDateTimeField
                      id="view-auth-session-expires"
                      label="Expires At"
                      required
                      value={viewSession.expires_at}
                      emptyPlaceholder="Select date"
                    />

                    <ReadOnlyDateTimeField
                      id="view-auth-session-revoked"
                      label="Revoked At"
                      value={viewSession.revoked_at}
                      emptyPlaceholder="Select date"
                    />
                  </div>
                </div>

                <div className="relative flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
                  {viewSession.revoked_at === null ? (
                    <div className="relative">
                      {deleteConfirmOpen ? (
                        <DeleteAuthSessionConfirmPopover
                          busy={revokingId === viewSession.id}
                          onCancel={() => setDeleteConfirmOpen(false)}
                          onConfirm={() => void performDeleteSession(viewSession)}
                        />
                      ) : null}
                      <button
                        type="button"
                        disabled={revokingId === viewSession.id}
                        onClick={() => setDeleteConfirmOpen(true)}
                        className="rounded-lg border-2 border-rose-500 bg-white px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => closeViewSession()}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
