"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChangeEvent } from "react";
import { ActiveIndicator } from "@/components/ActiveIndicator";
import {
  mapAppUserRecord,
  type AppUser,
  type AppUserApiRecord,
  type AppUserStatusFilter,
} from "@/modules/app-user/types";
import type { RbacRoleListItem } from "@/modules/user-role/types";
import { useAuthSession } from "@/modules/auth/components/AuthSessionProvider";
import {
  fetchApiData,
  fetchApiListWithPagination,
  fetchAppUserCreate,
  fetchAppUserEmailExists,
  getRequestErrorMessage,
  getRequestFieldErrors,
  type FieldErrors,
} from "@/lib/client/api";

type UserFormState = {
  email: string;
  fullName: string;
  roleId: string;
  active: boolean;
  useCustomPassword: boolean;
  password: string;
  passwordConfirm: string;
};

const DEFAULT_FORM_STATE: UserFormState = {
  email: "",
  fullName: "",
  roleId: "",
  active: true,
  useCustomPassword: false,
  password: "",
  passwordConfirm: "",
};

const INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

const DELETE_CONFIRM_POPOVER_WIDTH_PX = 288;

function LockIcon({ className = "h-4 w-4" }: Readonly<{ className?: string }>) {
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
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M7 11V8a5 5 0 0 1 10 0v3" />
    </svg>
  );
}

function EyeOpenIcon({ className = "h-5 w-5" }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className = "h-5 w-5" }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

const CHANGE_PASSWORD_INPUT_CLASS =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";
const APP_USER_EMAIL_LIVE_CHECK_DEBOUNCE_MS = 320;
type DeleteConfirmState = {
  user: AppUser;
  anchorRect: DOMRect;
};

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

function toFormState(user: AppUser): UserFormState {
  return {
    email: user.email,
    fullName: user.fullName,
    roleId: String(user.roleId),
    active: user.active,
    useCustomPassword: false,
    password: "",
    passwordConfirm: "",
  };
}

function toCreateApiPayload(formState: UserFormState) {
  const body: Record<string, unknown> = {
    email: formState.email.trim(),
    full_name: formState.fullName.trim(),
    role_id: Number.parseInt(formState.roleId, 10),
    deactivated_at: formState.active ? null : new Date().toISOString(),
    use_custom_password: formState.useCustomPassword,
  };

  if (formState.useCustomPassword && formState.password.trim() !== "") {
    body.password = formState.password;
  }

  return body;
}

function toUpdateRequestPayload(formState: UserFormState) {
  return {
    email: formState.email.trim(),
    full_name: formState.fullName.trim(),
    role_id: Number.parseInt(formState.roleId, 10),
    active: formState.active,
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

export function UsersManager() {
  const { session } = useAuthSession();
  const sessionOperatorUserId = session?.user.id ?? null;

  const [users, setUsers] = useState<AppUser[]>([]);
  const [roleOptions, setRoleOptions] = useState<RbacRoleListItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<AppUserStatusFilter>("all");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<keyof UserFormState>
  >({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actioningUserId, setActioningUserId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );
  const [loadingEditUserId, setLoadingEditUserId] = useState<number | null>(
    null,
  );
  const [editPreflightError, setEditPreflightError] = useState<string | null>(
    null,
  );
  const [editingAppUserId, setEditingAppUserId] = useState<number | null>(null);
  const [editingIsDefaultUser, setEditingIsDefaultUser] = useState(false);
  const [formState, setFormState] =
    useState<UserFormState>(DEFAULT_FORM_STATE);
  const [generatedPasswordModal, setGeneratedPasswordModal] = useState<
    string | null
  >(null);
  const [copyPasswordHint, setCopyPasswordHint] = useState<string | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordCurrent, setChangePasswordCurrent] = useState("");
  const [changePasswordNew, setChangePasswordNew] = useState("");
  const [changePasswordConfirm, setChangePasswordConfirm] = useState("");
  const [showChangePasswordCurrent, setShowChangePasswordCurrent] =
    useState(false);
  const [showChangePasswordNew, setShowChangePasswordNew] = useState(false);
  const [showChangePasswordConfirm, setShowChangePasswordConfirm] =
    useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(
    null,
  );
  const [changePasswordFieldErrors, setChangePasswordFieldErrors] = useState<
    FieldErrors<"current_password" | "password" | "passwordConfirm">
  >({});
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const appUserEmailCheckSeq = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await fetchApiListWithPagination<RbacRoleListItem>(
          "/api/rbac-roles?limit=200&offset=0&status=all",
        );
        setRoleOptions(data);
      } catch {
        setRoleOptions([]);
      }
    })();
  }, []);

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
  }, [search, statusFilter, roleFilter, pageSize]);

  const loadUsers = useCallback(async () => {
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

      if (roleFilter !== "all" && roleFilter !== "") {
        params.set("role_id", roleFilter);
      }

      const endpoint = `/api/app-users?${params.toString()}`;
      const { data: rows, pagination } =
        await fetchApiListWithPagination<AppUserApiRecord>(endpoint);

      setUsers(rows.map((row) => mapAppUserRecord(row)));
      setListTotal(pagination.total);

      const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize));

      setCurrentPage((page) => Math.min(page, totalPages));
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to load users."));
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, roleFilter, pageSize, currentPage]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      const seq = ++appUserEmailCheckSeq.current;

      void (async () => {
        try {
          const trimmed = formState.email.trim();
          if (trimmed === "") {
            if (appUserEmailCheckSeq.current === seq) {
              setFieldErrors((previous) => ({
                ...previous,
                email: undefined,
              }));
            }
            return;
          }

          const params = new URLSearchParams();
          params.set("email", trimmed);
          if (editingAppUserId !== null) {
            params.set("exclude_id", String(editingAppUserId));
          }

          const { exists } = await fetchAppUserEmailExists(params);

          if (appUserEmailCheckSeq.current !== seq) {
            return;
          }

          setFieldErrors((previous) => ({
            ...previous,
            email: exists ? "This email is already in use." : undefined,
          }));
        } catch (error) {
          if (appUserEmailCheckSeq.current !== seq) {
            return;
          }

          const fromDetails =
            getRequestFieldErrors<keyof UserFormState>(error);

          if (Object.keys(fromDetails).length > 0) {
            setFieldErrors((previous) => ({ ...previous, ...fromDetails }));
            return;
          }

          setFieldErrors((previous) => ({
            ...previous,
            email: getRequestErrorMessage(error, "Unable to verify email."),
          }));
        }
      })();
    }, APP_USER_EMAIL_LIVE_CHECK_DEBOUNCE_MS);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [isDrawerOpen, formState.email, editingAppUserId]);

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
    globalThis.window?.addEventListener("scroll", handleScrollOrResize, true);
    globalThis.window?.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      globalThis.window?.removeEventListener(
        "scroll",
        handleScrollOrResize,
        true,
      );
      globalThis.window?.removeEventListener("resize", handleScrollOrResize);
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

  function resetChangePasswordModal() {
    setChangePasswordOpen(false);
    setChangePasswordCurrent("");
    setChangePasswordNew("");
    setChangePasswordConfirm("");
    setShowChangePasswordCurrent(false);
    setShowChangePasswordNew(false);
    setShowChangePasswordConfirm(false);
    setChangePasswordError(null);
    setChangePasswordFieldErrors({});
    setIsChangingPassword(false);
  }

  function resetDrawer() {
    setIsDrawerOpen(false);
    setEditingAppUserId(null);
    setEditingIsDefaultUser(false);
    setFormState(DEFAULT_FORM_STATE);
    setFieldErrors({});
    setSubmitError(null);
    setEditPreflightError(null);
    resetChangePasswordModal();
  }

  function openCreateDrawer() {
    setEditingAppUserId(null);
    setEditingIsDefaultUser(false);
    setFormState(DEFAULT_FORM_STATE);
    setFieldErrors({});
    setSubmitError(null);
    setEditPreflightError(null);
    setIsDrawerOpen(true);
  }

  async function openEditDrawer(userId: number) {
    setEditPreflightError(null);
    setLoadingEditUserId(userId);

    try {
      const row = await fetchApiData<AppUserApiRecord>(
        `/api/app-users/${userId}`,
      );
      const user = mapAppUserRecord(row);

      setEditingAppUserId(userId);
      setEditingIsDefaultUser(user.isDefault);
      setFormState(toFormState(user));
      setFieldErrors({});
      setSubmitError(null);
      setIsDrawerOpen(true);
    } catch (error) {
      setEditPreflightError(
        getRequestErrorMessage(error, "Failed to load user."),
      );
    } finally {
      setLoadingEditUserId(null);
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

    if (editingIsDefaultUser) {
      return;
    }

    const roleIdParsed = Number.parseInt(formState.roleId, 10);
    if (!Number.isInteger(roleIdParsed) || roleIdParsed < 1) {
      setFieldErrors((previous) => ({
        ...previous,
        roleId: "Select a role.",
      }));
      return;
    }

    const wasCreate = editingAppUserId === null;

    if (wasCreate && formState.useCustomPassword) {
      if (formState.password.trim() === "") {
        setFieldErrors((previous) => ({
          ...previous,
          password: "Enter a password or turn off custom password.",
        }));
        return;
      }

      if (formState.password !== formState.passwordConfirm) {
        setFieldErrors((previous) => ({
          ...previous,
          passwordConfirm: "Passwords do not match.",
        }));
        return;
      }

      if (formState.password.length < 12) {
        setFieldErrors((previous) => ({
          ...previous,
          password: "Use at least 12 characters.",
        }));
        return;
      }
    }

    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(null);

    try {
      if (wasCreate) {
        const createResult = await fetchAppUserCreate(
          toCreateApiPayload(formState),
        );

        await loadUsers();
        resetDrawer();

        if (createResult.generatedPassword !== null) {
          setGeneratedPasswordModal(createResult.generatedPassword);
          setCopyPasswordHint(null);
        } else {
          setToastMessage(createResult.successMessage);
        }
      } else {
        await fetchApiData<AppUserApiRecord>(`/api/app-users/${editingAppUserId}`, {
          method: "PATCH",
          body: JSON.stringify(toUpdateRequestPayload(formState)),
        });

        await loadUsers();
        resetDrawer();
        setToastMessage("User updated successfully.");
      }
    } catch (error) {
      setFieldErrors(getRequestFieldErrors<keyof UserFormState>(error));
      setSubmitError(getRequestErrorMessage(error, "Failed to save user."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitChangePassword() {
    if (
      editingAppUserId === null ||
      sessionOperatorUserId === null ||
      editingAppUserId !== sessionOperatorUserId
    ) {
      return;
    }

    setChangePasswordFieldErrors({});
    setChangePasswordError(null);

    if (changePasswordCurrent === "") {
      setChangePasswordFieldErrors({
        current_password: "Enter your current password.",
      });
      return;
    }

    if (changePasswordNew.trim() === "") {
      setChangePasswordFieldErrors({
        password: "Enter a new password.",
      });
      return;
    }

    if (changePasswordNew.length < 12) {
      setChangePasswordFieldErrors({
        password: "Use at least 12 characters.",
      });
      return;
    }

    if (changePasswordNew !== changePasswordConfirm) {
      setChangePasswordFieldErrors({
        passwordConfirm: "Passwords do not match.",
      });
      return;
    }

    setIsChangingPassword(true);

    try {
      await fetchApiData<{ success: boolean }>("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          current_password: changePasswordCurrent,
          password: changePasswordNew,
        }),
      });

      resetChangePasswordModal();
      setToastMessage("Password updated successfully.");
    } catch (error) {
      const fe = getRequestFieldErrors<
        "current_password" | "password" | "passwordConfirm"
      >(error);

      if (Object.keys(fe).length > 0) {
        setChangePasswordFieldErrors(fe);
      } else {
        setChangePasswordError(
          getRequestErrorMessage(error, "Failed to update password."),
        );
      }
    } finally {
      setIsChangingPassword(false);
    }
  }

  function toggleDeleteConfirm(user: AppUser, trigger: HTMLButtonElement) {
    setSubmitError(null);

    setDeleteConfirm((current) => {
      if (current?.user.id === user.id) {
        return null;
      }

      return {
        user,
        anchorRect: trigger.getBoundingClientRect(),
      };
    });
  }

  async function confirmUserLogicalDelete(user: AppUser) {
    setActioningUserId(user.id);
    setSubmitError(null);

    try {
      await fetchApiData<AppUserApiRecord>(`/api/app-users/${user.id}`, {
        method: "DELETE",
      });

      await loadUsers();
      setDeleteConfirm(null);
      setToastMessage("User removed from the list.");
    } catch (error) {
      setSubmitError(getRequestErrorMessage(error, "Failed to delete user."));
    } finally {
      setActioningUserId(null);
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
            typeof globalThis.window !== "undefined"
              ? globalThis.window.innerWidth -
                DELETE_CONFIRM_POPOVER_WIDTH_PX -
                16
              : deleteConfirm.anchorRect.left,
          ),
        );

  const formLocked = editingIsDefaultUser;

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
            Users
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage application users.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadUsers()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateDrawer}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              Add User
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

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,160px)_180px_auto] md:items-end">
            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="appUserSearch"
              >
                Email, Full Name
              </label>
              <input
                id="appUserSearch"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search email or name"
                className={INPUT_CLASS_NAME}
              />
            </div>

            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="roleFilter"
              >
                Role
              </label>
              <select
                id="roleFilter"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
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

            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="userStatusFilter"
              >
                Active
              </label>
              <select
                id="userStatusFilter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as AppUserStatusFilter)
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
                  <th className="px-3 py-3 font-semibold">Email</th>
                  <th className="px-3 py-3 font-semibold">Full Name</th>
                  <th className="px-3 py-3 font-semibold">Role</th>
                  <th className="px-3 py-3 text-center font-semibold">Active</th>
                  <th className="px-3 py-3 font-semibold">Created At</th>
                  <th className="px-3 py-3 font-semibold">Updated At</th>
                  <th className="px-3 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && users.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-10 text-center text-sm text-slate-500"
                    >
                      No users found for the current filters.
                    </td>
                  </tr>
                ) : null}

                {users.map((user) => (
                  <tr key={user.id} className="transition hover:bg-slate-50">
                    <td className="px-3 py-4 font-medium text-slate-900">
                      {user.email}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {user.fullName}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {user.roleLabel}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex justify-center">
                        <ActiveIndicator active={user.active} />
                      </div>
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatCreatedAt(user.createdAt)}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatCreatedAt(user.updatedAt)}
                    </td>
                    <td className="px-3 py-4">
                      {(() => {
                        const isActioning = actioningUserId === user.id;
                        const deleteButtonClassName =
                          "border-rose-200 text-rose-700 hover:bg-rose-50";

                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void openEditDrawer(user.id)}
                              disabled={loadingEditUserId !== null}
                              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {loadingEditUserId === user.id
                                ? "Loading..."
                                : "Edit"}
                            </button>
                            {user.isDefault ? null : (
                              <button
                                type="button"
                                data-delete-trigger
                                onClick={(event) =>
                                  toggleDeleteConfirm(user, event.currentTarget)
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
              aria-labelledby="delete-app-user-title"
              aria-describedby="delete-app-user-desc"
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
                    id="delete-app-user-title"
                    className="font-semibold text-slate-900"
                  >
                    Delete User
                  </p>
                  <p
                    id="delete-app-user-desc"
                    className="mt-1 text-sm text-slate-600"
                  >
                    This action cannot be undone.
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      disabled={actioningUserId === deleteConfirm.user.id}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void confirmUserLogicalDelete(deleteConfirm.user)
                      }
                      disabled={actioningUserId === deleteConfirm.user.id}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actioningUserId === deleteConfirm.user.id
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

      {generatedPasswordModal !== null
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4">
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute inset-0 cursor-default"
                onClick={() => {
                  setGeneratedPasswordModal(null);
                  setCopyPasswordHint(null);
                }}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="generated-password-title"
                className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2
                    id="generated-password-title"
                    className="text-lg font-semibold text-slate-900"
                  >
                    Generated Password
                  </h2>
                  <button
                    type="button"
                    className="text-lg leading-none text-slate-400 transition hover:text-slate-700"
                    aria-label="Close"
                    onClick={() => {
                      setGeneratedPasswordModal(null);
                      setCopyPasswordHint(null);
                    }}
                  >
                    ×
                  </button>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  This password is shown only once. Copy it now and share it
                  securely with the user.
                </p>
                <input
                  id="generated-password-field"
                  readOnly
                  value={generatedPasswordModal}
                  className="mt-4 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none"
                />
                {copyPasswordHint ? (
                  <p className="mt-2 text-xs text-slate-600">
                    {copyPasswordHint}
                  </p>
                ) : null}
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setGeneratedPasswordModal(null);
                      setCopyPasswordHint(null);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const value = generatedPasswordModal;
                      void navigator.clipboard
                        .writeText(value)
                        .then(() => {
                          setCopyPasswordHint("Copied");
                          globalThis.setTimeout(() => {
                            setCopyPasswordHint(null);
                          }, 2000);
                        })
                        .catch(() => {
                          setCopyPasswordHint(
                            "Copy failed — select the password and copy manually.",
                          );
                        });
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
                  >
                    <svg
                      aria-hidden
                      className="h-4 w-4 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {changePasswordOpen &&
      editingAppUserId !== null &&
      sessionOperatorUserId !== null &&
      editingAppUserId === sessionOperatorUserId
        ? createPortal(
            <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/40 p-4">
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute inset-0 cursor-default"
                onClick={() => {
                  if (!isChangingPassword) {
                    resetChangePasswordModal();
                  }
                }}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="change-password-title"
                className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2
                    id="change-password-title"
                    className="text-lg font-semibold text-slate-900"
                  >
                    Change Password
                  </h2>
                  <button
                    type="button"
                    className="text-lg leading-none text-slate-400 transition hover:text-slate-700"
                    aria-label="Close"
                    disabled={isChangingPassword}
                    onClick={() => {
                      resetChangePasswordModal();
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="mt-6">
                  <label
                    className="text-sm font-medium text-slate-600"
                    htmlFor="change-password-current"
                  >
                    <span className="text-rose-500">*</span> Current Password
                  </label>
                  <div className="relative mt-2">
                    <input
                      id="change-password-current"
                      type={showChangePasswordCurrent ? "text" : "password"}
                      autoComplete="current-password"
                      value={changePasswordCurrent}
                      onChange={(e) => {
                        setChangePasswordCurrent(e.target.value);
                        setChangePasswordFieldErrors((c) => ({
                          ...c,
                          current_password: undefined,
                        }));
                        setChangePasswordError(null);
                      }}
                      disabled={isChangingPassword}
                      className={CHANGE_PASSWORD_INPUT_CLASS}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={
                        showChangePasswordCurrent
                          ? "Hide current password"
                          : "Show current password"
                      }
                      onClick={() =>
                        setShowChangePasswordCurrent((v) => !v)
                      }
                      disabled={isChangingPassword}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    >
                      {showChangePasswordCurrent ? (
                        <EyeOffIcon />
                      ) : (
                        <EyeOpenIcon />
                      )}
                    </button>
                  </div>
                  {changePasswordFieldErrors.current_password ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {changePasswordFieldErrors.current_password}
                    </p>
                  ) : null}
                </div>
                <div className="mt-6">
                  <label
                    className="text-sm font-medium text-slate-600"
                    htmlFor="change-password-new"
                  >
                    <span className="text-rose-500">*</span> New Password
                  </label>
                  <div className="relative mt-2">
                    <input
                      id="change-password-new"
                      type={showChangePasswordNew ? "text" : "password"}
                      autoComplete="new-password"
                      value={changePasswordNew}
                      onChange={(e) => {
                        setChangePasswordNew(e.target.value);
                        setChangePasswordFieldErrors((c) => ({
                          ...c,
                          password: undefined,
                        }));
                        setChangePasswordError(null);
                      }}
                      disabled={isChangingPassword}
                      className={CHANGE_PASSWORD_INPUT_CLASS}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={
                        showChangePasswordNew
                          ? "Hide new password"
                          : "Show new password"
                      }
                      onClick={() => setShowChangePasswordNew((v) => !v)}
                      disabled={isChangingPassword}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    >
                      {showChangePasswordNew ? (
                        <EyeOffIcon />
                      ) : (
                        <EyeOpenIcon />
                      )}
                    </button>
                  </div>
                  {changePasswordFieldErrors.password ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {changePasswordFieldErrors.password}
                    </p>
                  ) : null}
                </div>
                <div className="mt-6">
                  <label
                    className="text-sm font-medium text-slate-600"
                    htmlFor="change-password-confirm"
                  >
                    <span className="text-rose-500">*</span> Confirm Password
                  </label>
                  <div className="relative mt-2">
                    <input
                      id="change-password-confirm"
                      type={showChangePasswordConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      value={changePasswordConfirm}
                      onChange={(e) => {
                        setChangePasswordConfirm(e.target.value);
                        setChangePasswordFieldErrors((c) => ({
                          ...c,
                          passwordConfirm: undefined,
                        }));
                        setChangePasswordError(null);
                      }}
                      disabled={isChangingPassword}
                      className={CHANGE_PASSWORD_INPUT_CLASS}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={
                        showChangePasswordConfirm
                          ? "Hide confirm password"
                          : "Show confirm password"
                      }
                      onClick={() =>
                        setShowChangePasswordConfirm((v) => !v)
                      }
                      disabled={isChangingPassword}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    >
                      {showChangePasswordConfirm ? (
                        <EyeOffIcon />
                      ) : (
                        <EyeOpenIcon />
                      )}
                    </button>
                  </div>
                  {changePasswordFieldErrors.passwordConfirm ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {changePasswordFieldErrors.passwordConfirm}
                    </p>
                  ) : null}
                </div>
                {changePasswordError ? (
                  <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {changePasswordError}
                  </div>
                ) : null}
                <div className="mt-8 flex justify-end gap-3">
                  <button
                    type="button"
                    disabled={isChangingPassword}
                    onClick={() => {
                      resetChangePasswordModal();
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isChangingPassword}
                    onClick={() => void submitChangePassword()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isChangingPassword ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isDrawerOpen ? (
        <div className="fixed inset-0 z-50 flex bg-slate-900/25">
          <button
            type="button"
            aria-label="Close drawer backdrop"
            className="hidden flex-1 cursor-default md:block"
            onClick={resetDrawer}
          />

          <div className="ml-auto flex h-full min-h-0 w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={resetDrawer}
                  className="text-lg leading-none text-slate-400 transition hover:text-slate-700"
                  aria-label="Close"
                >
                  ×
                </button>
                <h3 className="text-xl font-semibold text-slate-900">
                  {editingAppUserId === null ? "Add User" : "Edit User"}
                </h3>
              </div>
            </div>

            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <div>
                  <label
                    className="text-sm font-medium text-slate-600"
                    htmlFor="appUserEmail"
                  >
                    <span className="text-rose-500">*</span> Email
                  </label>
                  <input
                    id="appUserEmail"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={formState.email}
                    onChange={handleInputChange}
                    placeholder="name@example.com"
                    disabled={formLocked}
                    className={`${INPUT_CLASS_NAME} ${formLocked ? "cursor-not-allowed bg-slate-50 text-slate-600" : ""}`}
                  />
                  {fieldErrors.email ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {fieldErrors.email}
                    </p>
                  ) : null}
                </div>

                <div className="mt-6">
                  <label
                    className="text-sm font-medium text-slate-600"
                    htmlFor="appUserFullName"
                  >
                    <span className="text-rose-500">*</span> Full Name
                  </label>
                  <input
                    id="appUserFullName"
                    name="fullName"
                    value={formState.fullName}
                    onChange={handleInputChange}
                    placeholder="e.g., Jane Smith"
                    disabled={formLocked}
                    className={`${INPUT_CLASS_NAME} ${formLocked ? "cursor-not-allowed bg-slate-50 text-slate-600" : ""}`}
                  />
                  {fieldErrors.fullName ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {fieldErrors.fullName}
                    </p>
                  ) : null}
                </div>

                <div className="mt-6">
                  <label
                    className="text-sm font-medium text-slate-600"
                    htmlFor="appUserRoleId"
                  >
                    <span className="text-rose-500">*</span> Role
                  </label>
                  <select
                    id="appUserRoleId"
                    name="roleId"
                    value={formState.roleId}
                    onChange={handleInputChange}
                    disabled={formLocked}
                    className={`${INPUT_CLASS_NAME} ${formLocked ? "cursor-not-allowed bg-slate-50 text-slate-600" : ""}`}
                  >
                    <option value="">Select a role</option>
                    {roleOptions.map((role) => (
                      <option key={role.id} value={String(role.id)}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.roleId ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {fieldErrors.roleId}
                    </p>
                  ) : null}
                </div>

                {editingAppUserId === null ? (
                  <>
                    <div className="mt-6 flex items-center justify-between gap-4">
                      <p className="text-sm font-medium text-slate-600">
                        Use custom password
                      </p>
                      <Toggle
                        checked={formState.useCustomPassword}
                        onChange={(useCustomPassword) =>
                          setFormState((current) => ({
                            ...current,
                            useCustomPassword,
                            password: useCustomPassword
                              ? current.password
                              : "",
                            passwordConfirm: useCustomPassword
                              ? current.passwordConfirm
                              : "",
                          }))
                        }
                      />
                    </div>

                    {formState.useCustomPassword ? (
                      <>
                        <div className="mt-6">
                          <label
                            className="text-sm font-medium text-slate-600"
                            htmlFor="appUserPassword"
                          >
                            <span className="text-rose-500">*</span> Password
                          </label>
                          <input
                            id="appUserPassword"
                            name="password"
                            type="password"
                            autoComplete="new-password"
                            value={formState.password}
                            onChange={handleInputChange}
                            placeholder="At least 12 characters"
                            className={INPUT_CLASS_NAME}
                          />
                          {fieldErrors.password ? (
                            <p className="mt-2 text-xs text-rose-600">
                              {fieldErrors.password}
                            </p>
                          ) : null}
                        </div>

                        <div className="mt-6">
                          <label
                            className="text-sm font-medium text-slate-600"
                            htmlFor="appUserPasswordConfirm"
                          >
                            <span className="text-rose-500">*</span> Confirm
                            password
                          </label>
                          <input
                            id="appUserPasswordConfirm"
                            name="passwordConfirm"
                            type="password"
                            autoComplete="new-password"
                            value={formState.passwordConfirm}
                            onChange={handleInputChange}
                            placeholder="Re-enter password"
                            className={INPUT_CLASS_NAME}
                          />
                          {fieldErrors.passwordConfirm ? (
                            <p className="mt-2 text-xs text-rose-600">
                              {fieldErrors.passwordConfirm}
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : null}

                <div className="mt-6">
                  <p className="text-sm font-medium text-slate-600">Active</p>
                  <div className="mt-3">
                    <Toggle
                      checked={formState.active}
                      disabled={formLocked}
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

              <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
                <div className="min-w-0">
                  {editingAppUserId !== null &&
                  sessionOperatorUserId !== null &&
                  editingAppUserId === sessionOperatorUserId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChangePasswordOpen(true);
                        setChangePasswordCurrent("");
                        setChangePasswordNew("");
                        setChangePasswordConfirm("");
                        setShowChangePasswordCurrent(false);
                        setShowChangePasswordNew(false);
                        setShowChangePasswordConfirm(false);
                        setChangePasswordError(null);
                        setChangePasswordFieldErrors({});
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                    >
                      <LockIcon />
                      Change Password
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={resetDrawer}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || formLocked}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isSubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
