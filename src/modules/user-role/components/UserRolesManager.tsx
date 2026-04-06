"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChangeEvent } from "react";
import { ActiveIndicator } from "@/components/ActiveIndicator";
import {
  mapRbacRoleListItemToUserRole,
  type RbacRoleDetailItem,
  type RbacRoleListItem,
  type UserRole,
  type UserRoleRow,
  type UserRoleStatusFilter,
} from "@/modules/user-role/types";
import {
  PERMISSION_CATEGORIES,
  type RbacPermissionApiRow,
} from "@/modules/user-role/permissions-catalog";
import { useAuthSession } from "@/modules/auth/components/AuthSessionProvider";
import {
  fetchApiData,
  fetchApiListWithPagination,
  fetchRbacPermissions,
  fetchUserRoleCodeExists,
  getRequestErrorMessage,
  getRequestFieldErrors,
  type FieldErrors,
} from "@/lib/client/api";

type UserRoleFormState = {
  label: string;
  code: string;
  active: boolean;
  permissions: string[];
};

const DEFAULT_USER_ROLE_FORM_STATE: UserRoleFormState = {
  label: "",
  code: "",
  active: true,
  permissions: [],
};

const INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

const DELETE_CONFIRM_POPOVER_WIDTH_PX = 288;
const USER_ROLE_CODE_LIVE_CHECK_DEBOUNCE_MS = 320;
const USER_ROLE_MODAL_FORM_ID = "user-role-modal-form";

type DeleteConfirmState = {
  userRole: UserRole;
  anchorRect: DOMRect;
};

type PermissionCategoryView = {
  id: string;
  label: string;
  permissions: { slug: string; label: string }[];
};

function formatCategoryIdToLabel(id: string): string {
  if (id === "other") {
    return "Other";
  }

  return id
    .split("_")
    .map((word) =>
      word.length
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : word,
    )
    .join(" ");
}

function staticPermissionCategoriesView(): PermissionCategoryView[] {
  return PERMISSION_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    permissions: category.permissions.map((p) => ({
      slug: p.slug,
      label: p.label,
    })),
  }));
}

function buildPermissionCategoriesFromApi(
  rows: RbacPermissionApiRow[],
): PermissionCategoryView[] {
  const byPrefix = new Map<string, RbacPermissionApiRow[]>();

  for (const row of rows) {
    const dot = row.code.indexOf(".");
    const prefix = dot === -1 ? "other" : row.code.slice(0, dot);
    const list = byPrefix.get(prefix) ?? [];
    list.push(row);
    byPrefix.set(prefix, list);
  }

  const categories: PermissionCategoryView[] = [];

  for (const [prefix, list] of byPrefix) {
    list.sort((a, b) => a.code.localeCompare(b.code));
    const staticCat = PERMISSION_CATEGORIES.find((c) => c.id === prefix);
    categories.push({
      id: prefix,
      label: staticCat?.label ?? formatCategoryIdToLabel(prefix),
      permissions: list.map((r) => ({ slug: r.code, label: r.label })),
    });
  }

  categories.sort((a, b) => a.label.localeCompare(b.label));
  return categories;
}

function formatCreatedAt(value: string): string {
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

function toFormStateFromDetail(
  detail: RbacRoleDetailItem,
  catalog: RbacPermissionApiRow[],
): UserRoleFormState {
  const codeById = new Map(catalog.map((r) => [r.id, r.code] as const));
  const permissions = detail.permission_ids
    .map((id) => codeById.get(id))
    .filter((c): c is string => typeof c === "string");

  return {
    label: detail.label,
    code: detail.code,
    active: detail.deactivated_at === null,
    permissions,
  };
}

function toCreateApiPayload(formState: UserRoleFormState) {
  return {
    label: formState.label.trim(),
    code: formState.code.trim(),
    deactivated_at: formState.active ? null : new Date().toISOString(),
    permissions: formState.permissions,
  };
}

function toUpdateRequestPayload(formState: UserRoleFormState) {
  return {
    label: formState.label,
    code: formState.code,
    active: formState.active,
    permissions: formState.permissions,
  };
}

function Toggle({
  checked,
  disabled = false,
  onChange,
}: Readonly<{
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onChange(!checked);
        }
      }}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
        checked ? "bg-blue-500" : "bg-slate-300"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function UserRolesManager() {
  const { session, refetch: refetchAuthSession } = useAuthSession();
  const operatorPermissions = session?.user.permissions ?? null;
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserRoleStatusFilter>("all");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<keyof UserRoleFormState>
  >({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actioningUserRoleId, setActioningUserRoleId] = useState<number | null>(
    null,
  );
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );
  const [loadingEditUserRoleId, setLoadingEditUserRoleId] = useState<
    number | null
  >(null);
  const [editPreflightError, setEditPreflightError] = useState<string | null>(
    null,
  );
  const [editingUserRoleId, setEditingUserRoleId] = useState<number | null>(
    null,
  );
  const [editingIsDefaultRole, setEditingIsDefaultRole] = useState(false);
  const [formState, setFormState] = useState<UserRoleFormState>(
    DEFAULT_USER_ROLE_FORM_STATE,
  );
  const [permissionRows, setPermissionRows] = useState<RbacPermissionApiRow[]>(
    [],
  );
  const permissionCategories = useMemo((): PermissionCategoryView[] => {
    if (permissionRows.length > 0) {
      return buildPermissionCategoriesFromApi(permissionRows);
    }

    return staticPermissionCategoriesView();
  }, [permissionRows]);

  const firstPermissionCategoryId =
    permissionCategories[0]?.id ??
    PERMISSION_CATEGORIES[0]?.id ??
    "audit_logs";

  const [permissionCategoryId, setPermissionCategoryId] = useState(
    () => PERMISSION_CATEGORIES[0]?.id ?? "audit_logs",
  );

  const userRoleCodeCheckSeq = useRef(0);

  const canWriteUserRoles =
    operatorPermissions?.includes("user_roles.write") ?? false;
  const canDeleteUserRoles =
    operatorPermissions?.includes("user_roles.delete") ?? false;
  const formFieldsLocked = editingIsDefaultRole || !canWriteUserRoles;

  useEffect(() => {
    setPermissionCategoryId((current) =>
      permissionCategories.some((c) => c.id === current)
        ? current
        : firstPermissionCategoryId,
    );
  }, [permissionCategories, firstPermissionCategoryId]);

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 250);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, pageSize]);

  const loadUserRoles = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String((currentPage - 1) * pageSize));

      if (search) {
        params.set("search", search);
      }

      params.set("status", statusFilter);

      const endpoint = `/api/rbac-roles?${params.toString()}`;
      const { data: rows, pagination } =
        await fetchApiListWithPagination<RbacRoleListItem>(endpoint);

      setUserRoles(rows.map(mapRbacRoleListItemToUserRole));
      setListTotal(pagination.total);

      const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize));

      setCurrentPage((page) => Math.min(page, totalPages));

      try {
        const permRows = await fetchRbacPermissions();
        setPermissionRows(permRows);
      } catch {
        setPermissionRows([]);
      }
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to load user roles."));
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, pageSize, currentPage]);

  useEffect(() => {
    void loadUserRoles();
  }, [loadUserRoles]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      const seq = ++userRoleCodeCheckSeq.current;

      void (async () => {
        try {
          const params = new URLSearchParams();
          params.set("code", formState.code);
          if (editingUserRoleId !== null) {
            params.set("exclude_id", String(editingUserRoleId));
          }

          const { exists } = await fetchUserRoleCodeExists(params);

          if (userRoleCodeCheckSeq.current !== seq) {
            return;
          }

          setFieldErrors((previous) => ({
            ...previous,
            code: exists ? "This code is already in use." : undefined,
          }));
        } catch (error) {
          if (userRoleCodeCheckSeq.current !== seq) {
            return;
          }

          const fromDetails =
            getRequestFieldErrors<keyof UserRoleFormState>(error);

          if (Object.keys(fromDetails).length > 0) {
            setFieldErrors((previous) => ({ ...previous, ...fromDetails }));
            return;
          }

          setFieldErrors((previous) => ({
            ...previous,
            code: getRequestErrorMessage(error, "Unable to verify code."),
          }));
        }
      })();
    }, USER_ROLE_CODE_LIVE_CHECK_DEBOUNCE_MS);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [isDrawerOpen, formState.code, editingUserRoleId]);

  useEffect(() => {
    if (!deleteConfirm) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement;

      if (
        target.closest("[data-delete-popover-root]") ||
        target.closest("[data-delete-trigger]")
      ) {
        return;
      }

      setDeleteConfirm(null);
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDeleteConfirm(null);
      }
    }

    function handleScrollOrResize() {
      setDeleteConfirm(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [deleteConfirm]);

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

  function resetDrawer() {
    setIsDrawerOpen(false);
    setEditingUserRoleId(null);
    setEditingIsDefaultRole(false);
    setFormState(DEFAULT_USER_ROLE_FORM_STATE);
    setPermissionCategoryId(firstPermissionCategoryId);
    setFieldErrors({});
    setSubmitError(null);
    setEditPreflightError(null);
  }

  function openCreateDrawer() {
    if (!canWriteUserRoles) {
      return;
    }

    setEditingUserRoleId(null);
    setEditingIsDefaultRole(false);
    setFormState(DEFAULT_USER_ROLE_FORM_STATE);
    setPermissionCategoryId(firstPermissionCategoryId);
    setFieldErrors({});
    setSubmitError(null);
    setEditPreflightError(null);
    setIsDrawerOpen(true);
  }

  async function openEditDrawer(userRoleId: number) {
    setEditPreflightError(null);
    setLoadingEditUserRoleId(userRoleId);

    try {
      const catalog =
        permissionRows.length > 0 ? permissionRows : await fetchRbacPermissions();
      const detail = await fetchApiData<RbacRoleDetailItem>(
        `/api/rbac-roles/${userRoleId}`,
      );

      setEditingUserRoleId(userRoleId);
      setEditingIsDefaultRole(detail.is_default);
      setFormState(toFormStateFromDetail(detail, catalog));
      setPermissionCategoryId(firstPermissionCategoryId);
      setFieldErrors({});
      setSubmitError(null);
      setIsDrawerOpen(true);
    } catch (error) {
      setEditPreflightError(
        getRequestErrorMessage(error, "Failed to load user role."),
      );
    } finally {
      setLoadingEditUserRoleId(null);
    }
  }

  function handleInputChange(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value } = event.target;

    setFormState((current) => ({
      ...current,
      [name]: value,
    }));
    setFieldErrors((current) => ({
      ...current,
      [name]: undefined,
      form: undefined,
    }));
    setSubmitError(null);
  }

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    if (editingIsDefaultRole || !canWriteUserRoles) {
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(null);

    const wasCreate = editingUserRoleId === null;

    try {
      if (wasCreate) {
        await fetchApiData<UserRoleRow>("/api/rbac-roles", {
          method: "POST",
          body: JSON.stringify(toCreateApiPayload(formState)),
        });
      } else {
        await fetchApiData<UserRoleRow>(
          `/api/rbac-roles/${editingUserRoleId}`,
          {
            method: "PATCH",
            body: JSON.stringify(toUpdateRequestPayload(formState)),
          },
        );
      }

      await loadUserRoles();
      resetDrawer();
      await refetchAuthSession();
      setToastMessage(
        wasCreate
          ? "User role created successfully."
          : "User role updated successfully.",
      );
    } catch (error) {
      setFieldErrors(getRequestFieldErrors<keyof UserRoleFormState>(error));
      setSubmitError(
        getRequestErrorMessage(error, "Failed to save user role."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleDeleteConfirm(userRole: UserRole, trigger: HTMLButtonElement) {
    if (!canDeleteUserRoles) {
      return;
    }

    setSubmitError(null);

    setDeleteConfirm((current) => {
      if (current?.userRole.id === userRole.id) {
        return null;
      }

      return {
        userRole,
        anchorRect: trigger.getBoundingClientRect(),
      };
    });
  }

  async function confirmUserRoleLogicalDelete(userRole: UserRole) {
    setActioningUserRoleId(userRole.id);
    setSubmitError(null);

    try {
      await fetchApiData<UserRoleRow>(`/api/rbac-roles/${userRole.id}`, {
        method: "DELETE",
      });

      await loadUserRoles();
      setDeleteConfirm(null);
      setToastMessage("User role removed from the list.");
    } catch (error) {
      setSubmitError(
        getRequestErrorMessage(error, "Failed to delete user role."),
      );
    } finally {
      setActioningUserRoleId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const deletePopoverLeft =
    deleteConfirm === null
      ? 0
      : Math.max(
          16,
          Math.min(
            deleteConfirm.anchorRect.left,
            typeof window !== "undefined"
              ? window.innerWidth - DELETE_CONFIRM_POPOVER_WIDTH_PX - 16
              : deleteConfirm.anchorRect.left,
          ),
        );

  const selectedPermissionCategory =
    permissionCategories.find((c) => c.id === permissionCategoryId) ??
    permissionCategories[0];

  function togglePermissionSlug(slug: string) {
    if (editingIsDefaultRole || !canWriteUserRoles) {
      return;
    }

    setFormState((current) => {
      const has = current.permissions.includes(slug);

      return {
        ...current,
        permissions: has
          ? current.permissions.filter((s) => s !== slug)
          : [...current.permissions, slug],
      };
    });
    setFieldErrors((current) => ({
      ...current,
      form: undefined,
    }));
    setSubmitError(null);
  }

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
            User Roles
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage user roles and permissions.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadUserRoles()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateDrawer}
              disabled={!canWriteUserRoles}
              title={
                !canWriteUserRoles
                  ? "You need User Roles — Add or edit permission."
                  : undefined
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Add User Role
            </button>
          </div>

          {loadError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {loadError}
            </div>
          ) : null}

          {editPreflightError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {editPreflightError}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,240px)_180px] md:items-end">
            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="userRoleSearch"
              >
                Label, Code
              </label>
              <input
                id="userRoleSearch"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search label or code"
                className={INPUT_CLASS_NAME}
              />
            </div>

            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="statusFilter"
              >
                Status
              </label>
              <select
                id="statusFilter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as UserRoleStatusFilter)
                }
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">Label</th>
                  <th className="px-3 py-3 font-semibold">Code</th>
                  <th className="px-3 py-3 text-center font-semibold">Active</th>
                  <th className="px-3 py-3 font-semibold">Created At</th>
                  <th className="px-3 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && userRoles.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-10 text-center text-sm text-slate-500"
                    >
                      No user roles found for the current filters.
                    </td>
                  </tr>
                ) : null}

                {userRoles.map((userRole) => (
                  <tr
                    key={userRole.id}
                    className="transition hover:bg-slate-50"
                  >
                    <td className="px-3 py-4 font-medium text-slate-900">
                      {userRole.label}
                    </td>
                    <td className="px-3 py-4 font-mono text-slate-700">
                      {userRole.code}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex justify-center">
                        <ActiveIndicator active={userRole.active} />
                      </div>
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatCreatedAt(userRole.createdAt)}
                    </td>
                    <td className="px-3 py-4">
                      {(() => {
                        const isActioning = actioningUserRoleId === userRole.id;
                        const deleteButtonClassName =
                          "border-rose-200 text-rose-700 hover:bg-rose-50";

                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void openEditDrawer(userRole.id)}
                              disabled={loadingEditUserRoleId !== null}
                              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {loadingEditUserRoleId === userRole.id
                                ? "Loading..."
                                : "Edit"}
                            </button>
                            {userRole.isDefault || !canDeleteUserRoles ? null : (
                              <button
                                type="button"
                                data-delete-trigger
                                onClick={(event) =>
                                  toggleDeleteConfirm(
                                    userRole,
                                    event.currentTarget,
                                  )
                                }
                                disabled={isActioning}
                                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${deleteButtonClassName} disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm text-slate-500">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safePage <= 1 || isLoading}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {"<"}
            </button>

            <span className="inline-flex min-w-8 items-center justify-center rounded-md border border-blue-200 bg-white px-3 py-1.5 font-medium text-blue-600">
              {safePage}
            </span>

            <button
              type="button"
              onClick={() =>
                setCurrentPage((page) => Math.min(totalPages, page + 1))
              }
              disabled={safePage >= totalPages || isLoading}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {">"}
            </button>

            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              disabled={isLoading}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 disabled:opacity-50"
            >
              <option value={10}>10 / page</option>
              <option value={20}>20 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
        </div>
      </section>

      {deleteConfirm
        ? createPortal(
            <div
              data-delete-popover-root
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-user-role-title"
              aria-describedby="delete-user-role-desc"
              className="fixed z-[100] w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
              style={{
                top: deleteConfirm.anchorRect.bottom + 8,
                left: deletePopoverLeft,
              }}
            >
              <div className="flex gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600"
                  aria-hidden
                >
                  <span className="text-lg font-bold leading-none">!</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    id="delete-user-role-title"
                    className="font-semibold text-slate-900"
                  >
                    Delete User Role
                  </p>
                  <p
                    id="delete-user-role-desc"
                    className="mt-1 text-sm text-slate-600"
                  >
                    This action cannot be undone.
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      disabled={
                        actioningUserRoleId === deleteConfirm.userRole.id
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void confirmUserRoleLogicalDelete(
                          deleteConfirm.userRole,
                        )
                      }
                      disabled={
                        actioningUserRoleId === deleteConfirm.userRole.id
                      }
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actioningUserRoleId === deleteConfirm.userRole.id
                        ? "Deleting..."
                        : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isDrawerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 md:p-8"
          role="presentation"
        >
          <button
            type="button"
            aria-label="Close dialog"
            className="fixed inset-0 cursor-default"
            onClick={resetDrawer}
          />

          <div
            className="relative z-10 my-4 flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl md:my-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-role-modal-title"
          >
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={resetDrawer}
                  className="shrink-0 text-lg leading-none text-slate-400 transition hover:text-slate-700"
                  aria-label="Close"
                >
                  ×
                </button>
                <h3
                  id="user-role-modal-title"
                  className="text-xl font-semibold text-slate-900"
                >
                  {editingUserRoleId === null
                    ? "Add User Role"
                    : "Edit User Role"}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={resetDrawer}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form={USER_ROLE_MODAL_FORM_ID}
                  disabled={isSubmitting || editingIsDefaultRole || !canWriteUserRoles}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isSubmitting ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            <form
              id={USER_ROLE_MODAL_FORM_ID}
              onSubmit={(event) => void handleSubmit(event)}
              className="flex max-h-[min(85vh,920px)] min-h-0 flex-col"
            >
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {!canWriteUserRoles && editingUserRoleId !== null ? (
                  <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    View only: your account does not have permission to edit user
                    roles.
                  </div>
                ) : null}
                <div className="grid gap-6 md:grid-cols-3 md:items-end">
                  <div>
                    <label
                      className="text-sm font-medium text-slate-600"
                      htmlFor="userRoleLabel"
                    >
                      <span className="text-rose-500">*</span> Label
                    </label>
                    <input
                      id="userRoleLabel"
                      name="label"
                      value={formState.label}
                      onChange={handleInputChange}
                      placeholder="e.g., Admin"
                      disabled={formFieldsLocked}
                      className={`${INPUT_CLASS_NAME} ${formFieldsLocked ? "cursor-not-allowed bg-slate-50 text-slate-600" : ""}`}
                    />
                    {fieldErrors.label ? (
                      <p className="mt-2 text-xs text-rose-600">
                        {fieldErrors.label}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label
                      className="text-sm font-medium text-slate-600"
                      htmlFor="userRoleCode"
                    >
                      <span className="text-rose-500">*</span> Code
                    </label>
                    <input
                      id="userRoleCode"
                      name="code"
                      value={formState.code}
                      onChange={handleInputChange}
                      placeholder="e.g., ADMIN"
                      disabled={formFieldsLocked}
                      className={`${INPUT_CLASS_NAME} ${formFieldsLocked ? "cursor-not-allowed bg-slate-50 text-slate-600" : ""}`}
                    />
                    {fieldErrors.code ? (
                      <p className="mt-2 text-xs text-rose-600">
                        {fieldErrors.code}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-600">Active</p>
                    <div className="mt-2">
                      <Toggle
                        checked={formState.active}
                        disabled={formFieldsLocked}
                        onChange={(active) =>
                          setFormState((current) => ({
                            ...current,
                            active,
                          }))
                        }
                      />
                    </div>
                    {fieldErrors.active ? (
                      <p className="mt-2 text-xs text-rose-600">
                        {fieldErrors.active}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-8">
                  <h4 className="text-sm font-semibold text-slate-900">
                    Permissions
                  </h4>
                  <div className="mt-3 flex max-h-[min(52vh,420px)] min-h-[260px] overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <aside className="w-52 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50">
                      {permissionCategories.map((category) => {
                        const isSelected = category.id === permissionCategoryId;

                        return (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => setPermissionCategoryId(category.id)}
                            className={`block w-full border-l-4 px-4 py-3 text-left text-sm transition ${
                              isSelected
                                ? "border-blue-500 bg-white font-medium text-blue-600"
                                : "border-transparent text-slate-600 hover:bg-slate-100/80"
                            }`}
                          >
                            {category.label}
                          </button>
                        );
                      })}
                    </aside>
                    <div className="min-w-0 flex-1 overflow-y-auto p-4">
                      {(selectedPermissionCategory?.permissions ?? []).map(
                        (perm) => {
                        const enabled = formState.permissions.includes(
                          perm.slug,
                        );

                        return (
                          <div
                            key={perm.slug}
                            className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900">
                                {perm.label}
                              </p>
                              <p className="mt-0.5 truncate font-mono text-xs text-slate-500">
                                {perm.slug}
                              </p>
                            </div>
                            <Toggle
                              checked={enabled}
                              disabled={formFieldsLocked}
                              onChange={() => {
                                togglePermissionSlug(perm.slug);
                              }}
                            />
                          </div>
                        );
                      },
                      )}
                    </div>
                  </div>
                  {fieldErrors.permissions ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {fieldErrors.permissions}
                    </p>
                  ) : null}
                </div>

                {fieldErrors.form ? (
                  <p className="mt-6 text-sm text-rose-600">
                    {fieldErrors.form}
                  </p>
                ) : null}

                {submitError ? (
                  <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {submitError}
                  </div>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
