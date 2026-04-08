"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ChangeEvent,
  FocusEvent,
  MouseEvent as ReactMouseEvent,
  SyntheticEvent,
} from "react";
import { ActiveIndicator } from "@/components/ActiveIndicator";
import type { ProviderApiRecord } from "@/modules/provider/types";
import {
  ApiRequestError,
  fetchApiData,
  fetchApiListWithPagination,
  getRequestErrorMessage,
  getRequestFieldErrors,
  type FieldErrors,
} from "@/lib/client/api";
import { useAuthSession } from "@/modules/auth/components/AuthSessionProvider";

type ProviderFormState = {
  abn: string;
  name: string;
  email: string;
  phone_number: string;
  address: string;
  unit_building: string;
  active: boolean;
};

type ProviderStatusFilter = "active" | "inactive" | "all";

type DeleteConfirmState = {
  provider: ProviderApiRecord;
  anchorRect: DOMRect;
};

const DEFAULT_FORM_STATE: ProviderFormState = {
  abn: "",
  name: "",
  email: "",
  phone_number: "",
  address: "",
  unit_building: "",
  active: true,
};

const INPUT_BASE_CLASS =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";
const INPUT_CLASS_NAME = `mt-2 ${INPUT_BASE_CLASS}`;
const INPUT_WITH_CLEAR_CLASS_NAME = `mt-2 ${INPUT_BASE_CLASS} pr-10`;
const DELETE_CONFIRM_POPOVER_WIDTH_PX = 384;

const MSG_EMAIL_INVALID = "Please enter a valid email (e.g., name@example.com)";
const MSG_PHONE_INVALID = "Phone number must be 3–16 digits.";
const MSG_PHONE_DIGITS_ONLY = "Phone number must contain digits only.";
const MSG_ABN_INVALID = "ABN must contain digits only and be 11 digits or fewer.";
const MSG_OPTIONAL_NON_EMPTY =
  "If provided, this field cannot be empty or whitespace only.";

const ABN_DIGITS = 11;
const PHONE_MIN_DIGITS = 3;
const PHONE_MAX_DIGITS = 16;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ValidatedProviderField =
  | "abn"
  | "name"
  | "email"
  | "phone_number"
  | "address"
  | "unit_building";

function validateProviderField(
  field: ValidatedProviderField,
  form: ProviderFormState,
): string | undefined {
  switch (field) {
    case "abn": {
      const t = form.abn.trim();

      if (t === "") {
        return "This field is required.";
      }

      if (!/^\d+$/.test(t) || t.length > ABN_DIGITS) {
        return MSG_ABN_INVALID;
      }

      return undefined;
    }

    case "name": {
      if (!form.name.trim()) {
        return "This field is required.";
      }

      return undefined;
    }

    case "email": {
      const email = form.email.trim().toLowerCase();

      if (!email) {
        return "This field is required.";
      }

      if (!EMAIL_SHAPE.test(email)) {
        return MSG_EMAIL_INVALID;
      }

      return undefined;
    }

    case "phone_number": {
      const t = form.phone_number.trim();

      if (t === "") {
        return undefined;
      }

      if (!/^\d+$/.test(t)) {
        return MSG_PHONE_DIGITS_ONLY;
      }

      if (t.length < PHONE_MIN_DIGITS || t.length > PHONE_MAX_DIGITS) {
        return MSG_PHONE_INVALID;
      }

      return undefined;
    }

    case "address": {
      if (form.address === "") {
        return undefined;
      }

      if (form.address.trim() === "") {
        return MSG_OPTIONAL_NON_EMPTY;
      }

      return undefined;
    }

    case "unit_building": {
      if (form.unit_building === "") {
        return undefined;
      }

      if (form.unit_building.trim() === "") {
        return MSG_OPTIONAL_NON_EMPTY;
      }

      return undefined;
    }
  }
}

function validateProviderFormLocal(
  form: ProviderFormState,
): FieldErrors<keyof ProviderFormState> {
  const errors: FieldErrors<keyof ProviderFormState> = {};

  const abn = validateProviderField("abn", form);
  if (abn) {
    errors.abn = abn;
  }

  const name = validateProviderField("name", form);
  if (name) {
    errors.name = name;
  }

  const email = validateProviderField("email", form);
  if (email) {
    errors.email = email;
  }

  const phone = validateProviderField("phone_number", form);
  if (phone) {
    errors.phone_number = phone;
  }

  const address = validateProviderField("address", form);
  if (address) {
    errors.address = address;
  }

  const unit = validateProviderField("unit_building", form);
  if (unit) {
    errors.unit_building = unit;
  }

  return errors;
}

function displayCell(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

function isProviderActive(row: ProviderApiRecord): boolean {
  return row.deactivated_at === null;
}

function toFormState(row: ProviderApiRecord): ProviderFormState {
  return {
    abn: row.abn,
    name: row.name.trim(),
    email: row.email,
    phone_number: row.phone_number ?? "",
    address: row.address ?? "",
    unit_building: row.unit_building ?? "",
    active: isProviderActive(row),
  };
}

function toRequestBody(form: ProviderFormState): Record<string, unknown> {
  const phoneT = form.phone_number.trim();

  return {
    abn: form.abn.trim(),
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    phone_number: phoneT === "" ? null : phoneT,
    address: form.address.trim() === "" ? null : form.address.trim(),
    unit_building:
      form.unit_building.trim() === "" ? null : form.unit_building.trim(),
    active: form.active,
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

function ClearFieldButton({
  ariaLabel,
  visible,
  onClear,
}: Readonly<{
  ariaLabel: string;
  visible: boolean;
  onClear: () => void;
}>) {
  if (!visible) {
    return null;
  }

  return (
    <button
      type="button"
      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      aria-label={ariaLabel}
      onClick={onClear}
    >
      <span className="text-[15px] leading-none" aria-hidden>
        ×
      </span>
    </button>
  );
}

export function ProvidersManager() {
  const { session } = useAuthSession();
  const canWriteProviders = Boolean(
    session?.user.permissions.includes("providers.write"),
  );
  const canDeleteProviders = Boolean(
    session?.user.permissions.includes("providers.delete"),
  );

  const [providers, setProviders] = useState<ProviderApiRecord[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProviderStatusFilter>("all");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<keyof ProviderFormState>
  >({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerReadOnly, setDrawerReadOnly] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<number | null>(
    null,
  );
  const [formState, setFormState] =
    useState<ProviderFormState>(DEFAULT_FORM_STATE);
  const [loadingEditId, setLoadingEditId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );

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

  const loadProviders = useCallback(async () => {
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

      const endpoint = `/api/providers?${params.toString()}`;
      const { data: rows, pagination } =
        await fetchApiListWithPagination<ProviderApiRecord>(endpoint);

      setProviders(rows);
      setListTotal(pagination.total);

      const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize));
      setCurrentPage((page) => Math.min(page, totalPages));
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to load providers."));
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, pageSize, currentPage]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  let deletePopoverMaxLeft = 0;

  if (deleteConfirm !== null) {
    deletePopoverMaxLeft =
      globalThis.window.innerWidth - DELETE_CONFIRM_POPOVER_WIDTH_PX - 16;
  }

  const deletePopoverLeft =
    deleteConfirm === null
      ? 0
      : Math.max(
          16,
          Math.min(
            deleteConfirm.anchorRect.left +
              deleteConfirm.anchorRect.width / 2 -
              DELETE_CONFIRM_POPOVER_WIDTH_PX / 2,
            deletePopoverMaxLeft,
          ),
        );
  const deletePopoverArrowLeft =
    deleteConfirm === null
      ? 0
      : Math.min(
          DELETE_CONFIRM_POPOVER_WIDTH_PX - 32,
          Math.max(
            24,
            deleteConfirm.anchorRect.left +
              deleteConfirm.anchorRect.width / 2 -
              deletePopoverLeft -
              8,
          ),
        );

  function openCreateDrawer() {
    if (!canWriteProviders) {
      return;
    }
    setEditingProviderId(null);
    setDrawerReadOnly(false);
    setFormState(DEFAULT_FORM_STATE);
    setFieldErrors({});
    setSubmitError(null);
    setToastMessage(null);
    setIsDrawerOpen(true);
  }

  function closeDrawer() {
    setIsDrawerOpen(false);
    setEditingProviderId(null);
    setDrawerReadOnly(false);
    setFormState(DEFAULT_FORM_STATE);
    setFieldErrors({});
    setSubmitError(null);
    setLoadingEditId(null);
  }

  async function openEditDrawer(providerId: number) {
    setSubmitError(null);
    setToastMessage(null);
    setFieldErrors({});
    setLoadingEditId(providerId);

    try {
      const row = await fetchApiData<ProviderApiRecord>(
        `/api/providers/${providerId}`,
      );
      setEditingProviderId(providerId);
      setFormState(toFormState(row));
      setDrawerReadOnly(!canWriteProviders);
      setIsDrawerOpen(true);
    } catch (error) {
      setSubmitError(
        getRequestErrorMessage(error, "Failed to load provider for editing."),
      );
    } finally {
      setLoadingEditId(null);
    }
  }

  function openDeleteConfirmPopover(
    provider: ProviderApiRecord,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    if (!canDeleteProviders) {
      return;
    }
    setDeleteConfirm({
      provider,
      anchorRect: event.currentTarget.getBoundingClientRect(),
    });
    setSubmitError(null);
    setToastMessage(null);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    let normalizedValue = value;

    if (name === "abn") {
      normalizedValue = value.replaceAll(/\D+/g, "").slice(0, ABN_DIGITS);
    } else if (name === "phone_number") {
      normalizedValue = value.replaceAll(/\D+/g, "").slice(0, PHONE_MAX_DIGITS);
    }

    setFormState((current) => ({
      ...current,
      [name]: normalizedValue,
    }));

    if (
      name === "abn" ||
      name === "name" ||
      name === "email" ||
      name === "phone_number" ||
      name === "address" ||
      name === "unit_building"
    ) {
      setFieldErrors((previous) => ({
        ...previous,
        [name]: undefined,
      }));
    }
  }

  function clearFormField(field: ValidatedProviderField) {
    setFormState((current) => ({ ...current, [field]: "" }));
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function handleValidatedFieldBlur(event: FocusEvent<HTMLInputElement>): void {
    const rawName = event.target.name;

    if (
      rawName !== "abn" &&
      rawName !== "name" &&
      rawName !== "email" &&
      rawName !== "phone_number" &&
      rawName !== "address" &&
      rawName !== "unit_building"
    ) {
      return;
    }

    const field = rawName as ValidatedProviderField;
    const snapshot: ProviderFormState = {
      ...formState,
      [field]: event.target.value,
    };

    setFieldErrors((previous) => ({
      ...previous,
      [field]: validateProviderField(field, snapshot),
    }));
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (drawerReadOnly) {
      return;
    }
    setSubmitError(null);
    setToastMessage(null);

    const localErrors = validateProviderFormLocal(formState);
    if (Object.values(localErrors).some(Boolean)) {
      setFieldErrors(localErrors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const body = toRequestBody(formState);
      const isEditing = editingProviderId !== null;

      if (isEditing) {
        await fetchApiData<ProviderApiRecord>(
          `/api/providers/${editingProviderId}`,
          {
            method: "PATCH",
            body: JSON.stringify(body),
          },
        );
      } else {
        await fetchApiData<ProviderApiRecord>("/api/providers", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }

      await loadProviders();
      closeDrawer();
      setToastMessage(
        isEditing
          ? "Provider updated successfully."
          : "Provider created successfully.",
      );
    } catch (error) {
      const nextFieldErrors = getRequestFieldErrors<keyof ProviderFormState>(error);
      setFieldErrors(nextFieldErrors);

      const hasInlineErrors = Object.keys(nextFieldErrors).some(
        (key) => key !== "form",
      );

      if (
        error instanceof ApiRequestError &&
        error.code === "VALIDATION_ERROR" &&
        hasInlineErrors
      ) {
        setSubmitError(null);
      } else {
        setSubmitError(getRequestErrorMessage(error, "Failed to save provider."));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(row: ProviderApiRecord) {
    setDeletingId(row.id);
    setDeleteConfirm(null);
    setSubmitError(null);
    setToastMessage(null);

    try {
      await fetchApiData<{ id: number; deleted_at: string }>(
        `/api/providers/${row.id}`,
        { method: "DELETE" },
      );

      if (editingProviderId === row.id) {
        closeDrawer();
      }

      setToastMessage("Provider removed successfully.");
      await loadProviders();
    } catch (error) {
      setSubmitError(
        getRequestErrorMessage(error, "Failed to delete provider."),
      );
    } finally {
      setDeletingId(null);
    }
  }

  let drawerTitle = "Edit Provider";
  if (editingProviderId === null) {
    drawerTitle = "Add Provider";
  } else if (drawerReadOnly) {
    drawerTitle = "View Provider";
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
            Providers
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage provider records.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadProviders()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateDrawer}
              disabled={!canWriteProviders}
              title={
                !canWriteProviders
                  ? "You need providers.write to add providers."
                  : undefined
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Add Provider
            </button>
          </div>

          {loadError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {loadError}
            </div>
          ) : null}

          {submitError && !isDrawerOpen ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {submitError}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:items-end">
            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="providerSearch"
              >
                Search ABN, name or email
              </label>
              <input
                id="providerSearch"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search ABN, name or email"
                className={INPUT_CLASS_NAME}
              />
            </div>
            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="providerStatusFilter"
              >
                Active
              </label>
              <select
                id="providerStatusFilter"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as ProviderStatusFilter)
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
                  <th className="px-3 py-3 font-semibold">ABN</th>
                  <th className="px-3 py-3 font-semibold">Name</th>
                  <th className="px-3 py-3 font-semibold">Email</th>
                  <th className="px-3 py-3 font-semibold">Phone Number</th>
                  <th className="px-3 py-3 font-semibold">Address</th>
                  <th className="px-3 py-3 font-semibold">Unit/Building</th>
                  <th className="px-3 py-3 text-center font-semibold">
                    Active
                  </th>
                  <th className="px-3 py-3 text-center font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && providers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-10 text-center text-sm text-slate-500"
                    >
                      No providers found for the current filters.
                    </td>
                  </tr>
                ) : null}

                {providers.map((p) => (
                  <tr key={p.id} className="transition hover:bg-slate-50">
                    <td className="px-3 py-4 font-medium text-slate-900">
                      {p.abn}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {p.name.trim()}
                    </td>
                    <td className="px-3 py-4 text-slate-700">{p.email}</td>
                    <td className="px-3 py-4 text-slate-700">
                      {displayCell(p.phone_number)}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {displayCell(p.address)}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {displayCell(p.unit_building)}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex justify-center">
                        <ActiveIndicator active={isProviderActive(p)} />
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => void openEditDrawer(p.id)}
                          disabled={loadingEditId !== null}
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {loadingEditId === p.id
                            ? "Loading..."
                            : canWriteProviders
                              ? "Edit"
                              : "View"}
                        </button>
                        <button
                          type="button"
                          data-delete-trigger
                          onClick={(event) => openDeleteConfirmPopover(p, event)}
                          disabled={!canDeleteProviders || deletingId === p.id}
                          title={
                            !canDeleteProviders
                              ? "You need providers.delete to remove providers."
                              : undefined
                          }
                          className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingId === p.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
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
              onChange={(e) => setPageSize(Number(e.target.value))}
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

      {isDrawerOpen ? (
        <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/60">
          <div
            className="h-full w-full max-w-md border-l border-slate-200 bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-drawer-title"
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  <span className="block text-xl leading-none" aria-hidden>
                    ×
                  </span>
                </button>
                <h3
                  id="provider-drawer-title"
                  className="text-xl font-semibold tracking-tight text-slate-900"
                >
                  {drawerTitle}
                </h3>
              </div>

              <form
                onSubmit={(e) => void handleSubmit(e)}
                className="flex flex-1 flex-col overflow-y-auto px-5 py-4"
              >
                {submitError ? (
                  <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {submitError}
                  </div>
                ) : null}

                <label className="text-sm font-medium text-slate-600">
                  <span className="text-rose-600">*</span> ABN
                  <div className="relative">
                    <input
                      name="abn"
                      value={formState.abn}
                      onChange={handleInputChange}
                      onBlur={handleValidatedFieldBlur}
                      placeholder="e.g., 12345678901"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={ABN_DIGITS}
                      disabled={drawerReadOnly}
                      className={INPUT_WITH_CLEAR_CLASS_NAME}
                    />
                    <ClearFieldButton
                      ariaLabel="Clear ABN"
                      visible={!drawerReadOnly && formState.abn !== ""}
                      onClear={() => clearFormField("abn")}
                    />
                  </div>
                  {fieldErrors.abn ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {fieldErrors.abn}
                    </p>
                  ) : null}
                </label>

                <label className="mt-5 text-sm font-medium text-slate-600">
                  <span className="text-rose-600">*</span>{" "}Name
                  <input
                    name="name"
                    value={formState.name}
                    onChange={handleInputChange}
                    onBlur={handleValidatedFieldBlur}
                    placeholder="e.g., Acme Plan Managers"
                    disabled={drawerReadOnly}
                    className={INPUT_CLASS_NAME}
                  />
                  {fieldErrors.name ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {fieldErrors.name}
                    </p>
                  ) : null}
                </label>

                <label className="mt-5 text-sm font-medium text-slate-600">
                  <span className="text-rose-600">*</span>{" "}Email
                  <input
                    name="email"
                    type="email"
                    value={formState.email}
                    onChange={handleInputChange}
                    onBlur={handleValidatedFieldBlur}
                    placeholder="e.g., name@example.com"
                    autoComplete="email"
                    disabled={drawerReadOnly}
                    className={INPUT_CLASS_NAME}
                  />
                  {fieldErrors.email ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {fieldErrors.email}
                    </p>
                  ) : null}
                </label>

                <label className="mt-5 text-sm font-medium text-slate-600">
                  Phone Number
                  <div className="relative">
                    <input
                      name="phone_number"
                      value={formState.phone_number}
                      onChange={handleInputChange}
                      onBlur={handleValidatedFieldBlur}
                      placeholder="e.g., 1800123456"
                      inputMode="numeric"
                      autoComplete="tel"
                      maxLength={PHONE_MAX_DIGITS}
                      disabled={drawerReadOnly}
                      className={INPUT_WITH_CLEAR_CLASS_NAME}
                    />
                    <ClearFieldButton
                      ariaLabel="Clear phone number"
                      visible={!drawerReadOnly && formState.phone_number !== ""}
                      onClear={() => clearFormField("phone_number")}
                    />
                  </div>
                  {fieldErrors.phone_number ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {fieldErrors.phone_number}
                    </p>
                  ) : null}
                </label>

                <label className="mt-5 text-sm font-medium text-slate-600">
                  Address
                  <div className="relative">
                    <input
                      name="address"
                      value={formState.address}
                      onChange={handleInputChange}
                      onBlur={handleValidatedFieldBlur}
                      disabled={drawerReadOnly}
                      className={INPUT_WITH_CLEAR_CLASS_NAME}
                    />
                    <ClearFieldButton
                      ariaLabel="Clear address"
                      visible={!drawerReadOnly && formState.address !== ""}
                      onClear={() => clearFormField("address")}
                    />
                  </div>
                  {fieldErrors.address ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {fieldErrors.address}
                    </p>
                  ) : null}
                </label>

                <label className="mt-5 text-sm font-medium text-slate-600">
                  Unit/Building
                  <div className="relative">
                    <input
                      name="unit_building"
                      value={formState.unit_building}
                      onChange={handleInputChange}
                      onBlur={handleValidatedFieldBlur}
                      disabled={drawerReadOnly}
                      className={INPUT_WITH_CLEAR_CLASS_NAME}
                    />
                    <ClearFieldButton
                      ariaLabel="Clear unit or building"
                      visible={!drawerReadOnly && formState.unit_building !== ""}
                      onClear={() => clearFormField("unit_building")}
                    />
                  </div>
                  {fieldErrors.unit_building ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {fieldErrors.unit_building}
                    </p>
                  ) : null}
                </label>

                <div className="mt-6">
                  <p className="text-sm font-medium text-slate-600">Active</p>
                  <div className="mt-3">
                    <Toggle
                      checked={formState.active}
                      disabled={drawerReadOnly}
                      onChange={(active) =>
                        setFormState((c) => ({ ...c, active }))
                      }
                    />
                  </div>
                  {fieldErrors.active ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {fieldErrors.active}
                    </p>
                  ) : null}
                </div>

                <div className="mt-auto flex justify-end gap-3 border-t border-slate-100 pt-5">
                  <button
                    type="button"
                    onClick={closeDrawer}
                    className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  {drawerReadOnly ? null : (
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
                    >
                      {isSubmitting ? "Saving..." : "Save"}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirm
        ? createPortal(
            <div
              data-delete-popover-root
              className="fixed z-60 w-96 rounded-[22px] border border-slate-200 bg-white p-5 shadow-2xl"
              style={{
                top: deleteConfirm.anchorRect.bottom + 12,
                left: deletePopoverLeft,
              }}
            >
              <div
                className="absolute -top-2 h-4 w-4 rotate-45 border-t border-l border-slate-200 bg-white"
                style={{ left: deletePopoverArrowLeft }}
                aria-hidden="true"
              />

              <div className="flex items-start gap-4">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-500"
                  aria-hidden="true"
                >
                  <span className="text-base font-semibold leading-none">!</span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[19px] font-semibold text-slate-900">
                    Delete Provider
                  </p>
                  <p className="mt-3 text-[15px] text-slate-700">
                    This action cannot be undone.
                  </p>

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      disabled={deletingId === deleteConfirm.provider.id}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(deleteConfirm.provider)}
                      disabled={
                        !canDeleteProviders ||
                        deletingId === deleteConfirm.provider.id
                      }
                      className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingId === deleteConfirm.provider.id
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
    </div>
  );
}
