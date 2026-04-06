"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppUserOptionRow } from "@/modules/app-user/types";
import type {
  AuditLogOption,
  AuditLogRow,
} from "@/modules/audit-log/types";
import type { RbacRoleOptionRow } from "@/modules/user-role/types";
import {
  fetchApiData,
  fetchApiListWithPagination,
  getRequestErrorMessage,
} from "@/lib/client/api";

const INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

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

function toPrettyJson(value: Record<string, unknown> | null): string {
  if (!value || Object.keys(value).length === 0) {
    return "—";
  }

  return JSON.stringify(value, null, 2);
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

  const loadOptions = useCallback(async () => {
    setOptionsError(null);

    try {
      const [users, roles, actions, entities, permissions] = await Promise.all([
        fetchApiData<AppUserOptionRow[]>("/api/app-users/options"),
        fetchApiData<RbacRoleOptionRow[]>("/api/rbac-roles/options"),
        fetchApiData<AuditLogOption[]>("/api/audit-logs/options/actions"),
        fetchApiData<AuditLogOption[]>("/api/audit-logs/options/entities"),
        fetchApiData<AuditLogOption[]>("/api/audit-logs/options/permissions"),
      ]);

      setUserOptions(users);
      setRoleOptions(roles);
      setActionOptions(actions);
      setEntityOptions(entities);
      setPermissionOptions(permissions);
    } catch (error) {
      setOptionsError(
        getRequestErrorMessage(error, "Failed to load audit log filter options."),
      );
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
        <td className="max-w-56 px-4 py-3 text-slate-500">
          <span className="line-clamp-2">
            {row.before ?? "—"}
          </span>
        </td>
        <td className="max-w-56 px-4 py-3 text-slate-500">
          <span className="line-clamp-2">
            {row.after ?? "—"}
          </span>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {formatDateTime(row.created_at)}
        </td>
        <td className="px-4 py-3 text-right">
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

  return (
    <>
      <section className="space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Audit Logs</h1>
              <p className="mt-1 text-sm text-slate-500">
                Review recorded admin changes across users, invoices, rate sets,
                and related entities.
              </p>
            </div>
            <div className="text-sm text-slate-500">
              Total records: <span className="font-medium text-slate-900">{totalRows}</span>
            </div>
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
              <select
                value={userIdFilter}
                onChange={(event) => setUserIdFilter(event.target.value)}
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All users</option>
                {userOptions.map((option) => (
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
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {tableContent}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-blue-500"
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage <= 1}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>

              {paginationItems.map((item, index) => {
                if (item === "ellipsis") {
                  const hasEarlierEllipsis = paginationItems
                    .slice(0, index)
                    .includes("ellipsis");

                  return (
                    <span
                      key={hasEarlierEllipsis ? "ellipsis-end" : "ellipsis-start"}
                      className="px-2 text-slate-400"
                    >
                      ...
                    </span>
                  );
                }

                const buttonClass =
                  currentPage === item
                    ? "rounded-lg bg-slate-900 px-3 py-2 text-sm text-white transition"
                    : "rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50";

                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCurrentPage(item)}
                    className={buttonClass}
                  >
                    {item}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage >= totalPages}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </section>

      {viewRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Audit Log Details
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {viewRow.action_label} · {viewRow.entity} ·{" "}
                  {formatDateTime(viewRow.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewRow(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 overflow-y-auto p-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Payload</h3>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap wrap-break-word text-xs text-slate-700">
                  {toPrettyJson(viewRow.payload)}
                </pre>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Changes Diff</h3>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap wrap-break-word text-xs text-slate-700">
                  {toPrettyJson(viewRow.changes_diff)}
                </pre>
              </div>
            </div>

            <div className="border-t border-slate-200 px-6 py-4 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-900">Before:</span>{" "}
                {viewRow.before ?? "—"}
              </p>
              <p className="mt-2">
                <span className="font-medium text-slate-900">After:</span>{" "}
                {viewRow.after ?? "—"}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
