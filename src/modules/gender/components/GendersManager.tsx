"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChangeEvent } from "react";
import { ActiveIndicator } from "@/components/ActiveIndicator";
import {
  mapGenderRow,
  type Gender,
  type GenderRow,
  type GenderStatusFilter,
} from "@/modules/gender/types";
import {
  fetchApiData,
  fetchApiListWithPagination,
  fetchGenderCodeExists,
  getRequestErrorMessage,
  getRequestFieldErrors,
  type FieldErrors,
} from "@/lib/client/api";

type GenderFormState = {
  label: string;
  code: string;
  active: boolean;
};

const DEFAULT_FORM_STATE: GenderFormState = {
  label: "",
  code: "",
  active: true,
};

const INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

const DELETE_CONFIRM_POPOVER_WIDTH_PX = 288;
const GENDER_CODE_LIVE_CHECK_DEBOUNCE_MS = 320;

type DeleteConfirmState = {
  gender: Gender;
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

function toFormState(gender: Gender): GenderFormState {
  return {
    label: gender.label,
    code: gender.code,
    active: gender.active,
  };
}

function toCreateApiPayload(formState: GenderFormState) {
  return {
    label: formState.label.trim(),
    code: formState.code.trim(),
    deactivated_at: formState.active ? null : new Date().toISOString(),
  };
}

function toUpdateRequestPayload(formState: GenderFormState) {
  return {
    label: formState.label,
    code: formState.code,
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

export function GendersManager() {
  const [genders, setGenders] = useState<Gender[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<GenderStatusFilter>("all");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<keyof GenderFormState>
  >({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actioningGenderId, setActioningGenderId] = useState<number | null>(
    null,
  );
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );
  const [loadingEditGenderId, setLoadingEditGenderId] = useState<number | null>(
    null,
  );
  const [editPreflightError, setEditPreflightError] = useState<string | null>(
    null,
  );
  const [editingGenderId, setEditingGenderId] = useState<number | null>(null);
  const [formState, setFormState] =
    useState<GenderFormState>(DEFAULT_FORM_STATE);
  const genderCodeCheckSeq = useRef(0);

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

  const loadGenders = useCallback(async () => {
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

      const endpoint = `/api/genders?${params.toString()}`;
      const { data: rows, pagination } =
        await fetchApiListWithPagination<GenderRow>(endpoint);

      setGenders(rows.map(mapGenderRow));
      setListTotal(pagination.total);

      const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize));

      setCurrentPage((page) => Math.min(page, totalPages));
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to load genders."));
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, pageSize, currentPage]);

  useEffect(() => {
    void loadGenders();
  }, [loadGenders]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      const seq = ++genderCodeCheckSeq.current;

      void (async () => {
        try {
          const params = new URLSearchParams();
          params.set("code", formState.code);
          if (editingGenderId !== null) {
            params.set("exclude_id", String(editingGenderId));
          }

          const { exists } = await fetchGenderCodeExists(params);

          if (genderCodeCheckSeq.current !== seq) {
            return;
          }

          setFieldErrors((previous) => ({
            ...previous,
            code: exists ? "This code is already in use." : undefined,
          }));
        } catch (error) {
          if (genderCodeCheckSeq.current !== seq) {
            return;
          }

          const fromDetails =
            getRequestFieldErrors<keyof GenderFormState>(error);

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
    }, GENDER_CODE_LIVE_CHECK_DEBOUNCE_MS);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [isDrawerOpen, formState.code, editingGenderId]);

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
    setEditingGenderId(null);
    setFormState(DEFAULT_FORM_STATE);
    setFieldErrors({});
    setSubmitError(null);
    setEditPreflightError(null);
  }

  function openCreateDrawer() {
    setEditingGenderId(null);
    setFormState(DEFAULT_FORM_STATE);
    setFieldErrors({});
    setSubmitError(null);
    setEditPreflightError(null);
    setIsDrawerOpen(true);
  }

  async function openEditDrawer(genderId: number) {
    setEditPreflightError(null);
    setLoadingEditGenderId(genderId);

    try {
      const row = await fetchApiData<GenderRow>(`/api/genders/${genderId}`);
      const genderModel = mapGenderRow(row);

      setEditingGenderId(genderId);
      setFormState(toFormState(genderModel));
      setFieldErrors({});
      setSubmitError(null);
      setIsDrawerOpen(true);
    } catch (error) {
      setEditPreflightError(
        getRequestErrorMessage(error, "Failed to load gender."),
      );
    } finally {
      setLoadingEditGenderId(null);
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
    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(null);

    const wasCreate = editingGenderId === null;

    try {
      if (wasCreate) {
        await fetchApiData<GenderRow>("/api/genders", {
          method: "POST",
          body: JSON.stringify(toCreateApiPayload(formState)),
        });
      } else {
        await fetchApiData<GenderRow>(`/api/genders/${editingGenderId}`, {
          method: "PATCH",
          body: JSON.stringify(toUpdateRequestPayload(formState)),
        });
      }

      await loadGenders();
      resetDrawer();
      setToastMessage(
        wasCreate
          ? "Gender created successfully."
          : "Gender updated successfully.",
      );
    } catch (error) {
      setFieldErrors(getRequestFieldErrors<keyof GenderFormState>(error));
      setSubmitError(getRequestErrorMessage(error, "Failed to save gender."));
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleDeleteConfirm(gender: Gender, trigger: HTMLButtonElement) {
    setSubmitError(null);

    setDeleteConfirm((current) => {
      if (current?.gender.id === gender.id) {
        return null;
      }

      return {
        gender,
        anchorRect: trigger.getBoundingClientRect(),
      };
    });
  }

  async function confirmGenderLogicalDelete(gender: Gender) {
    setActioningGenderId(gender.id);
    setSubmitError(null);

    try {
      await fetchApiData<GenderRow>(`/api/genders/${gender.id}`, {
        method: "DELETE",
      });

      await loadGenders();
      setDeleteConfirm(null);
      setToastMessage("Gender removed from the list.");
    } catch (error) {
      setSubmitError(getRequestErrorMessage(error, "Failed to delete gender."));
    } finally {
      setActioningGenderId(null);
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
            Genders
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage gender dropdown values.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadGenders()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateDrawer}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              Add Gender
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

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,240px)_180px_auto] md:items-end">
            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="genderSearch"
              >
                Label, Code
              </label>
              <input
                id="genderSearch"
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
                  setStatusFilter(event.target.value as GenderStatusFilter)
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
                  <th className="px-3 py-3 font-semibold">Updated At</th>
                  <th className="px-3 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && genders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-10 text-center text-sm text-slate-500"
                    >
                      No genders found for the current filters.
                    </td>
                  </tr>
                ) : null}

                {genders.map((gender) => (
                  <tr key={gender.id} className="transition hover:bg-slate-50">
                    <td className="px-3 py-4 font-medium text-slate-900">
                      {gender.label}
                    </td>
                    <td className="px-3 py-4 font-mono text-slate-700">
                      {gender.code}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex justify-center">
                        <ActiveIndicator active={gender.active} />
                      </div>
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatCreatedAt(gender.createdAt)}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatCreatedAt(gender.updatedAt)}
                    </td>
                    <td className="px-3 py-4">
                      {(() => {
                        const isActioning = actioningGenderId === gender.id;
                        const deleteButtonClassName =
                          "border-rose-200 text-rose-700 hover:bg-rose-50";

                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void openEditDrawer(gender.id)}
                              disabled={loadingEditGenderId !== null}
                              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {loadingEditGenderId === gender.id
                                ? "Loading..."
                                : "Edit"}
                            </button>
                            <button
                              type="button"
                              data-delete-trigger
                              onClick={(event) =>
                                toggleDeleteConfirm(gender, event.currentTarget)
                              }
                              disabled={isActioning}
                              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${deleteButtonClassName} disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                              Delete
                            </button>
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
              aria-labelledby="delete-gender-title"
              aria-describedby="delete-gender-desc"
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
                    id="delete-gender-title"
                    className="font-semibold text-slate-900"
                  >
                    Delete Gender
                  </p>
                  <p
                    id="delete-gender-desc"
                    className="mt-1 text-sm text-slate-600"
                  >
                    This action cannot be undone.
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      disabled={actioningGenderId === deleteConfirm.gender.id}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void confirmGenderLogicalDelete(deleteConfirm.gender)
                      }
                      disabled={actioningGenderId === deleteConfirm.gender.id}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actioningGenderId === deleteConfirm.gender.id
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
                  className="text-lg text-slate-400 transition hover:text-slate-700"
                >
                  x
                </button>
                <h3 className="text-xl font-semibold text-slate-900">
                  {editingGenderId === null ? "Add Gender" : "Edit Gender"}
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
                    htmlFor="genderLabel"
                  >
                    <span className="text-rose-500">*</span> Label
                  </label>
                  <input
                    id="genderLabel"
                    name="label"
                    value={formState.label}
                    onChange={handleInputChange}
                    placeholder="e.g., Female"
                    className={INPUT_CLASS_NAME}
                  />
                  {fieldErrors.label ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {fieldErrors.label}
                    </p>
                  ) : null}
                </div>

                <div className="mt-6">
                  <label
                    className="text-sm font-medium text-slate-600"
                    htmlFor="genderCode"
                  >
                    <span className="text-rose-500">*</span> Code
                  </label>
                  <input
                    id="genderCode"
                    name="code"
                    value={formState.code}
                    onChange={handleInputChange}
                    placeholder="e.g., FEMALE"
                    className={INPUT_CLASS_NAME}
                  />
                  {fieldErrors.code ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {fieldErrors.code}
                    </p>
                  ) : null}
                </div>

                <div className="mt-6">
                  <p className="text-sm font-medium text-slate-600">Active</p>
                  <div className="mt-3">
                    <Toggle
                      checked={formState.active}
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

              <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
                <button
                  type="button"
                  onClick={resetDrawer}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isSubmitting ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
