"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppUserOptionRow } from "@/modules/app-user/types";
import type {
  AuditLogChangeDiff,
  AuditLogOption,
  AuditLogRow,
} from "@/modules/audit-log/types";
import {
  AUDIT_LOG_ACTION_OPTIONS,
  AUDIT_LOG_ENTITY_OPTIONS,
  AUDIT_LOG_PERMISSION_OPTIONS,
} from "@/modules/audit-log/types";
import type { RbacRoleOptionRow } from "@/modules/user-role/types";
import {
  fetchApiData,
  fetchApiListWithPagination,
  getRequestErrorMessage,
} from "@/lib/client/api";

const INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

/** Sticky last column for wide audit table horizontal scroll. */
const STICKY_ACTIONS_HEAD =
  "sticky right-0 z-20 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-4 py-3 shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.12)]";
const STICKY_ACTIONS_CELL =
  "sticky right-0 z-10 whitespace-nowrap border-l border-slate-200 bg-white px-4 py-3 shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.12)]";

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

function buildPaginationItems(
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

  for (let page = start; page <= end; page += 1) {
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

function formatAuditDiffScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function countChangeDiffKeys(diff: AuditLogChangeDiff | null): number {
  if (!diff) {
    return 0;
  }

  return Object.keys(diff).length;
}

const READONLY_FIELD_BOX =
  "mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900";

function ReadonlyAuditField({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div>
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <div className={READONLY_FIELD_BOX}>
        {value.trim() === "" ? "—" : value}
      </div>
    </div>
  );
}

function PaginationChevronLeftIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function PaginationChevronRightIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function PaginationChevronDownIcon() {
  return (
    <svg
      className="h-4 w-4 text-slate-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function DateRangeField({
  heading,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
}: Readonly<{
  heading: string;
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
          type="date"
          value={startValue}
          onChange={(event) => onStartChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
        />
        <span className="text-slate-400" aria-hidden>
          →
        </span>
        <input
          type="date"
          value={endValue}
          onChange={(event) => onEndChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}

export function AuditLogsManager() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [userOptions, setUserOptions] = useState<AppUserOptionRow[]>([]);
  const [roleOptions, setRoleOptions] = useState<RbacRoleOptionRow[]>([]);
  const [actionOptions, setActionOptions] = useState<AuditLogOption[]>([]);
  const [entityOptions, setEntityOptions] = useState<AuditLogOption[]>([]);
  const [permissionOptions, setPermissionOptions] = useState<AuditLogOption[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userIdFilter, setUserIdFilter] = useState("all");
  const [roleIdFilter, setRoleIdFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [permissionFilter, setPermissionFilter] = useState("all");
  const [createdStart, setCreatedStart] = useState("");
  const [createdEnd, setCreatedEnd] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<AuditLogRow | null>(null);

  useEffect(() => {
    if (viewRow === null) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setViewRow(null);
      }
    }

    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [viewRow]);

  useEffect(() => {
    if (viewRow === null) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [viewRow]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    userIdFilter,
    roleIdFilter,
    actionFilter,
    entityFilter,
    permissionFilter,
    createdStart,
    createdEnd,
    pageSize,
  ]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalRows / pageSize)),
    [pageSize, totalRows],
  );
  const paginationItems = useMemo(
    () => buildPaginationItems(totalPages, currentPage),
    [currentPage, totalPages],
  );

  const filteredUserOptions = useMemo(() => {
    const q = userSearchQuery.trim().toLowerCase();

    const matched =
      q === ""
        ? userOptions
        : userOptions.filter((option) =>
            option.label.toLowerCase().includes(q),
          );

    if (userIdFilter === "all") {
      return matched;
    }

    const selected = userOptions.find(
      (option) => String(option.id) === userIdFilter,
    );

    if (!selected || matched.some((option) => option.id === selected.id)) {
      return matched;
    }

    return [selected, ...matched];
  }, [userOptions, userSearchQuery, userIdFilter]);

  const loadOptions = useCallback(async () => {
    setOptionsError(null);
    const failures: string[] = [];

    let users: AppUserOptionRow[] = [];

    try {
      users = await fetchApiData<AppUserOptionRow[]>(
        "/api/app-users/options",
        undefined,
        { redirectOnForbidden: false },
      );
    } catch (error) {
      failures.push(
        getRequestErrorMessage(error, "Could not load user options."),
      );
    }

    setUserOptions(users);

    let roles: RbacRoleOptionRow[] = [];

    try {
      roles = await fetchApiData<RbacRoleOptionRow[]>(
        "/api/rbac-roles/options",
        undefined,
        { redirectOnForbidden: false },
      );
    } catch (error) {
      failures.push(
        getRequestErrorMessage(error, "Could not load role options."),
      );
    }

    setRoleOptions(roles);

    try {
      const actions = await fetchApiData<AuditLogOption[]>(
        "/api/audit-logs/options/actions",
        undefined,
        { redirectOnForbidden: false },
      );
      setActionOptions(actions);
    } catch (error) {
      failures.push(
        getRequestErrorMessage(error, "Could not load action options."),
      );
      setActionOptions([...AUDIT_LOG_ACTION_OPTIONS]);
    }

    try {
      const entities = await fetchApiData<AuditLogOption[]>(
        "/api/audit-logs/options/entities",
        undefined,
        { redirectOnForbidden: false },
      );
      setEntityOptions(entities);
    } catch (error) {
      failures.push(
        getRequestErrorMessage(error, "Could not load entity options."),
      );
      setEntityOptions([...AUDIT_LOG_ENTITY_OPTIONS]);
    }

    try {
      const permissions = await fetchApiData<AuditLogOption[]>(
        "/api/audit-logs/options/permissions",
        undefined,
        { redirectOnForbidden: false },
      );
      setPermissionOptions(permissions);
    } catch (error) {
      failures.push(
        getRequestErrorMessage(error, "Could not load permission options."),
      );
      setPermissionOptions([...AUDIT_LOG_PERMISSION_OPTIONS]);
    }

    if (failures.length > 0) {
      setOptionsError(failures.join(" "));
    }
  }, []);

  const loadRows = useCallback(async () => {
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

      if (actionFilter !== "all") {
        params.set("action", actionFilter);
      }

      if (entityFilter !== "all") {
        params.set("entity", entityFilter);
      }

      if (permissionFilter !== "all") {
        params.set("permission", permissionFilter);
      }

      if (createdStart) {
        params.set("created_start", createdStart);
      }

      if (createdEnd) {
        params.set("created_end", createdEnd);
      }

      const endpoint = `/api/audit-logs?${params.toString()}`;
      const { data, pagination } =
        await fetchApiListWithPagination<AuditLogRow>(endpoint);

      setRows(data);
      setTotalRows(pagination.total);
      setCurrentPage((page) => Math.min(page, Math.max(1, Math.ceil(pagination.total / pageSize))));
    } catch (error) {
      setLoadError(
        getRequestErrorMessage(error, "Failed to load audit logs."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    actionFilter,
    createdEnd,
    createdStart,
    currentPage,
    entityFilter,
    pageSize,
    permissionFilter,
    roleIdFilter,
    userIdFilter,
  ]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([loadOptions(), loadRows()]);
  }, [loadOptions, loadRows]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  let tableContent: ReactNode;

  if (isLoading) {
    tableContent = (
      <tr>
        <td className="px-4 py-10 text-center text-slate-500" colSpan={10}>
          Loading audit logs...
        </td>
      </tr>
    );
  } else if (rows.length === 0) {
    tableContent = (
      <tr>
        <td className="px-4 py-10 text-center text-slate-500" colSpan={10}>
          No audit logs found.
        </td>
      </tr>
    );
  } else {
    tableContent = rows.map((row) => (
      <tr key={row.id} className="align-top">
        <td className="px-4 py-3">{row.actor_user_label ?? "—"}</td>
        <td className="px-4 py-3">{row.actor_role_label ?? "—"}</td>
        <td className="px-4 py-3">{row.action_label}</td>
        <td className="px-4 py-3">{row.permission_label ?? "—"}</td>
        <td className="px-4 py-3">{row.entity}</td>
        <td className="px-4 py-3">{row.entity_id ?? "—"}</td>
        <td className="max-w-48 px-4 py-3 text-slate-500">
          <span
            className="block max-w-full truncate"
            title={row.before ?? undefined}
          >
            {row.before ?? "—"}
          </span>
        </td>
        <td className="max-w-48 px-4 py-3 text-slate-500">
          <span
            className="block max-w-full truncate"
            title={row.after ?? undefined}
          >
            {row.after ?? "—"}
          </span>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {formatDateTime(row.created_at)}
        </td>
        <td className={`text-right ${STICKY_ACTIONS_CELL}`}>
          <button
            type="button"
            onClick={() => setViewRow(row)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            View
          </button>
        </td>
      </tr>
    ));
  }

  const viewChangeCount = countChangeDiffKeys(viewRow?.changes_diff ?? null);

  return (
    <>
      <section className="space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Audit Logs</h1>
            <p className="mt-1 text-sm text-slate-500">
              Maintain and inspect audit logs.
            </p>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          {optionsError ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {optionsError}
            </div>
          ) : null}

          {loadError ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {loadError}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-500">User</span>
              <input
                type="search"
                value={userSearchQuery}
                onChange={(event) => setUserSearchQuery(event.target.value)}
                placeholder="Search user"
                autoComplete="off"
                className={INPUT_CLASS_NAME}
              />
              <select
                value={userIdFilter}
                onChange={(event) => setUserIdFilter(event.target.value)}
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All users</option>
                {filteredUserOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-500">Role</span>
              <select
                value={roleIdFilter}
                onChange={(event) => setRoleIdFilter(event.target.value)}
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All roles</option>
                {roleOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-500">Action</span>
              <select
                value={actionFilter}
                onChange={(event) => setActionFilter(event.target.value)}
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All actions</option>
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-500">Permission</span>
              <select
                value={permissionFilter}
                onChange={(event) => setPermissionFilter(event.target.value)}
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All permissions</option>
                {permissionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-500">Entity</span>
              <select
                value={entityFilter}
                onChange={(event) => setEntityFilter(event.target.value)}
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All entities</option>
                {entityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <DateRangeField
              heading="Created At"
              startValue={createdStart}
              endValue={createdEnd}
              onStartChange={setCreatedStart}
              onEndChange={setCreatedEnd}
            />
          </div>

          <div className="mt-6 overflow-x-auto rounded-3xl border border-slate-200">
            <table className="min-w-[1400px] divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Permission</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Entity ID</th>
                  <th className="px-4 py-3">Before</th>
                  <th className="px-4 py-3">After</th>
                  <th className="px-4 py-3">Created At</th>
                  <th className={`text-right ${STICKY_ACTIONS_HEAD}`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {tableContent}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-1 sm:gap-2">
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage <= 1}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PaginationChevronLeftIcon />
            </button>

            {paginationItems.map((item, index) => {
              if (item === "ellipsis") {
                const hasEarlierEllipsis = paginationItems
                  .slice(0, index)
                  .includes("ellipsis");

                return (
                  <span
                    key={
                      hasEarlierEllipsis ? "ellipsis-end" : "ellipsis-start"
                    }
                    className="flex h-9 min-w-9 items-center justify-center px-1 text-sm text-slate-400"
                  >
                    …
                  </span>
                );
              }

              const isActive = currentPage === item;
              const pageButtonClass = isActive
                ? "h-9 min-w-9 rounded-md border border-blue-500 bg-white px-2 text-sm font-medium text-blue-600 transition"
                : "h-9 min-w-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-medium text-slate-900 transition hover:border-slate-300";

              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCurrentPage(item)}
                  aria-current={isActive ? "page" : undefined}
                  className={pageButtonClass}
                >
                  {item}
                </button>
              );
            })}

            <button
              type="button"
              aria-label="Next page"
              onClick={() =>
                setCurrentPage((page) => Math.min(totalPages, page + 1))
              }
              disabled={currentPage >= totalPages}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PaginationChevronRightIcon />
            </button>

            <div className="relative ml-1 shrink-0 sm:ml-2">
              <select
                value={pageSize}
                aria-label="Rows per page"
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-9 min-w-[7.5rem] cursor-pointer appearance-none rounded-md border border-slate-200 bg-white py-0 pl-3 pr-9 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                <PaginationChevronDownIcon />
              </span>
            </div>
          </div>
        </div>
      </section>

      {viewRow ? (
        <div
          className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-white"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-view-title"
        >
            <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-6 py-4">
              <button
                type="button"
                aria-label="Close"
                onClick={() => setViewRow(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
              >
                <span className="text-lg leading-none" aria-hidden>
                  ×
                </span>
              </button>
              <h2
                id="audit-view-title"
                className="text-lg font-semibold text-slate-900"
              >
                View Audit Log
              </h2>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <ReadonlyAuditField
                  label="User"
                  value={viewRow.actor_user_label ?? ""}
                />
                <ReadonlyAuditField
                  label="Role"
                  value={viewRow.actor_role_label ?? ""}
                />
                <ReadonlyAuditField
                  label="Action"
                  value={viewRow.action_label}
                />
                <ReadonlyAuditField
                  label="Permission"
                  value={viewRow.permission_label ?? ""}
                />
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <ReadonlyAuditField label="Entity" value={viewRow.entity} />
                <ReadonlyAuditField
                  label="Entity ID"
                  value={viewRow.entity_id ?? ""}
                />
              </div>

              <section className="mt-8">
                <h3 className="text-base font-semibold text-slate-900">
                  Changes
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {viewChangeCount} changed field
                  {viewChangeCount === 1 ? "" : "s"}
                </p>

                {viewRow.changes_diff &&
                Object.keys(viewRow.changes_diff).length > 0 ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-4 py-3 font-semibold text-slate-700">
                            Before
                          </th>
                          <th className="px-4 py-3 font-semibold text-slate-700">
                            After
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {Object.entries(viewRow.changes_diff).map(
                          ([fieldKey, pair]) => {
                            const beforeText = formatAuditDiffScalar(
                              pair.before,
                            );
                            const afterText = formatAuditDiffScalar(pair.after);
                            const hasBefore = beforeText !== "";
                            const hasAfter = afterText !== "";

                            const beforeCellClass = hasBefore
                              ? "bg-rose-50 px-4 py-3 text-slate-800 shadow-[inset_0_0_0_1px_rgb(254_205_211)]"
                              : "bg-white px-4 py-3 text-slate-700";
                            const afterCellClass = hasAfter
                              ? "bg-emerald-50 px-4 py-3 text-slate-800 shadow-[inset_0_0_0_1px_rgb(167_243_208)]"
                              : "bg-white px-4 py-3 text-slate-700";

                            return (
                              <tr key={fieldKey} className="align-top">
                                <td className={beforeCellClass}>
                                  <div className="font-medium text-slate-900">
                                    {fieldKey}
                                  </div>
                                  <div
                                    className={`mt-2 min-h-5 font-mono text-xs ${hasBefore ? "text-rose-950" : "text-slate-500"}`}
                                  >
                                    {beforeText}
                                  </div>
                                </td>
                                <td className={afterCellClass}>
                                  <div className="font-medium text-slate-900">
                                    {fieldKey}
                                  </div>
                                  <div
                                    className={`mt-2 min-h-5 font-mono text-xs ${hasAfter ? "text-emerald-950" : "text-slate-500"}`}
                                  >
                                    {afterText === "" ? "—" : afterText}
                                  </div>
                                </td>
                              </tr>
                            );
                          },
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    <p>No field-level diff was recorded for this entry.</p>
                    {viewRow.before || viewRow.after ? (
                      <p className="mt-3 text-left font-mono text-xs text-slate-600">
                        {viewRow.before ? (
                          <>
                            <span className="font-sans font-medium text-slate-700">
                              Summary before:{" "}
                            </span>
                            {viewRow.before}
                          </>
                        ) : null}
                        {viewRow.before && viewRow.after ? (
                          <br />
                        ) : null}
                        {viewRow.after ? (
                          <>
                            <span className="font-sans font-medium text-slate-700">
                              Summary after:{" "}
                            </span>
                            {viewRow.after}
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                )}
              </section>
            </div>

            <footer className="flex shrink-0 justify-end border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setViewRow(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            </footer>
        </div>
      ) : null}
    </>
  );
}
