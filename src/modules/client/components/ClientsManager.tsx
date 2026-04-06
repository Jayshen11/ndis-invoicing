"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ChangeEvent,
  MouseEvent as ReactMouseEvent,
  SyntheticEvent,
} from "react";
import { mapClientRow, type Client, type ClientRow } from "@/modules/client/types";
import type { GenderOption, GenderRow } from "@/modules/gender/types";
import type { PricingRegionOption } from "@/modules/rate-set/types";
import {
  ApiRequestError,
  fetchApiData,
  getRequestErrorMessage,
  getRequestFieldErrors,
  type FieldErrors,
} from "@/lib/client/api";
import { useAuthSession } from "@/modules/auth/components/AuthSessionProvider";

type ClientFormState = {
  firstName: string;
  lastName: string;
  genderId: string;
  dob: string;
  ndisNumber: string;
  email: string;
  phoneNumber: string;
  address: string;
  unitBuilding: string;
  pricingRegion: string;
  active: boolean;
};

type ClientStatusFilter = "all" | "active" | "inactive";

type ClientsResponse = {
  clients: Client[];
};

type PricingRegionsResponse = {
  pricingRegions: PricingRegionOption[];
};

type ParticipantDrawerProps = Readonly<{
  fieldErrors: FieldErrors<keyof ClientFormState>;
  formState: ClientFormState;
  genders: GenderOption[];
  canSaveParticipant: boolean;
  canEditGenderSelect: boolean;
  genderReadonlyLabel: string | null;
  canEditPricingRegionSelect: boolean;
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onInputChange: (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => void;
  onActiveChange: (checked: boolean) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  /** Merged API catalogue and/or distinct codes from loaded participants. */
  pricingRegionOptions: PricingRegionOption[];
  /** View-only (e.g. clients.read without clients.write): all fields disabled, no save. */
  readOnly: boolean;
  /** When true, catalogue requirements for Save apply (add flow only). */
  isCreatingParticipant: boolean;
  title: string;
}>;

type PaginationControlsProps = Readonly<{
  currentPage: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (value: number) => void;
  onPageSizeChange: (value: number) => void;
}>;

type DeleteConfirmState = {
  client: Client;
  anchorRect: DOMRect;
};

const DEFAULT_FORM_STATE: ClientFormState = {
  firstName: "",
  lastName: "",
  genderId: "",
  dob: "",
  ndisNumber: "",
  email: "",
  phoneNumber: "",
  address: "",
  unitBuilding: "",
  pricingRegion: "",
  active: true,
};

const FIELD_INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

const DELETE_CONFIRM_POPOVER_WIDTH_PX = 384;
const NDIS_NUMBER_MAX_LENGTH = 16;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PARTICIPANT_FIELD_LABELS: Record<keyof ClientFormState, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  genderId: "Gender",
  dob: "Date of Birth",
  ndisNumber: "NDIS Number",
  email: "Email",
  phoneNumber: "Phone Number",
  address: "Address",
  unitBuilding: "Unit / Building",
  pricingRegion: "Pricing Region",
  active: "Active",
};

function getParticipantFieldClass(hasError: boolean): string {
  return hasError
    ? `${FIELD_INPUT_CLASS_NAME} border-rose-300 focus:border-rose-400`
    : FIELD_INPUT_CLASS_NAME;
}

function getParticipantFieldErrorMessage(
  field: keyof ClientFormState,
  message: string | undefined,
): string | null {
  if (!message) {
    return null;
  }

  if (message === "This field is required.") {
    return `${PARTICIPANT_FIELD_LABELS[field]} is required`;
  }

  if (field === "genderId" && message === "Must be a positive integer.") {
    return "Gender is required";
  }

  return message;
}

function getParticipantEmailValidationMessage(value: string): string | null {
  const trimmedValue = value.trim();

  if (trimmedValue === "") {
    return null;
  }

  return SIMPLE_EMAIL_PATTERN.test(trimmedValue)
    ? null
    : "Please enter a valid email (e.g., name@example.com)";
}

function formatDate(value: string): string {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return `${day}/${month}/${year}`;
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

  return parts.join("/");
}

function toDateInputValue(value: string): string {
  const dateOnlyMatch = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (dateOnlyMatch?.[1]) {
    return dateOnlyMatch[1];
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return parsedDate.toISOString().slice(0, 10);
}

function sortClients(clients: Client[]): Client[] {
  return [...clients].sort((left, right) => {
    const leftKey = `${left.lastName} ${left.firstName} ${left.id}`.toLowerCase();
    const rightKey =
      `${right.lastName} ${right.firstName} ${right.id}`.toLowerCase();

    return leftKey.localeCompare(rightKey);
  });
}

function toFormState(client: Client): ClientFormState {
  return {
    firstName: client.firstName,
    lastName: client.lastName,
    genderId: String(client.genderId),
    dob: toDateInputValue(client.dob),
    ndisNumber: client.ndisNumber,
    email: client.email,
    phoneNumber: client.phoneNumber ?? "",
    address: client.address,
    unitBuilding: client.unitBuilding ?? "",
    pricingRegion: client.pricingRegion,
    active: client.deactivatedAt === null,
  };
}

function toRequestPayload(formState: ClientFormState) {
  return {
    first_name: formState.firstName,
    last_name: formState.lastName,
    gender_id: formState.genderId === "" ? null : Number(formState.genderId),
    dob: formState.dob,
    ndis_number: formState.ndisNumber,
    email: formState.email,
    phone_number: formState.phoneNumber || null,
    address: formState.address,
    unit_building: formState.unitBuilding || null,
    pricing_region: formState.pricingRegion,
    deactivated_at: formState.active ? null : new Date().toISOString(),
  };
}

function getClientStatus(client: Client): Exclude<ClientStatusFilter, "all"> {
  return client.deactivatedAt ? "inactive" : "active";
}

function getClientSearchText(client: Client): string {
  return [
    client.firstName,
    client.lastName,
    client.ndisNumber,
    client.email,
  ]
    .join(" ")
    .toLowerCase();
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

function ActiveStatusIcon({ active }: Readonly<{ active: boolean }>) {
  if (active) {
    return (
      <span
        aria-label="Active"
        className="inline-flex h-5 w-5 items-center justify-center text-sky-600"
        title="Active"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M7.2 10.1 9.1 12l3.9-4.3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-label="Inactive"
      className="inline-flex h-5 w-5 items-center justify-center text-sky-600"
      title="Inactive"
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M7.6 7.6 12.4 12.4M12.4 7.6 7.6 12.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function PaginationControls({
  currentPage,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm text-slate-500">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {"<"}
      </button>

      <span className="inline-flex min-w-8 items-center justify-center rounded-md border border-blue-200 bg-white px-3 py-1.5 font-medium text-blue-600">
        {currentPage}
      </span>

      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {">"}
      </button>

      <select
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-blue-500"
      >
        <option value={10}>10 / page</option>
        <option value={20}>20 / page</option>
        <option value={50}>50 / page</option>
        <option value={100}>100 / page</option>
      </select>
    </div>
  );
}

function buildPricingRegionOptionsFromClients(
  clientRows: Client[],
): PricingRegionOption[] {
  const codes = [...new Set(clientRows.map((c) => c.pricingRegion))].sort(
    (a, b) => a.localeCompare(b, "en"),
  );

  return codes.map((code) => {
    const label = code.replaceAll("_", " ");

    return {
      code,
      label,
      fullLabel: label,
    };
  });
}

function formatClientGenderDisplay(
  client: Client,
  genderLabelById: Map<string, string>,
): string {
  if (client.genderLabel) {
    return client.genderLabel;
  }

  const fromCatalog = genderLabelById.get(String(client.genderId));

  if (fromCatalog) {
    return fromCatalog;
  }

  return `#${client.genderId}`;
}

function ParticipantDrawer({
  fieldErrors,
  formState,
  genders,
  canSaveParticipant,
  canEditGenderSelect,
  genderReadonlyLabel,
  canEditPricingRegionSelect,
  isOpen,
  isSubmitting,
  onClose,
  onInputChange,
  onActiveChange,
  onSubmit,
  pricingRegionOptions,
  readOnly,
  isCreatingParticipant,
  title,
}: ParticipantDrawerProps) {
  if (!isOpen) {
    return null;
  }

  const ro = readOnly;

  const firstNameError = getParticipantFieldErrorMessage(
    "firstName",
    fieldErrors.firstName,
  );
  const lastNameError = getParticipantFieldErrorMessage(
    "lastName",
    fieldErrors.lastName,
  );
  const genderError = getParticipantFieldErrorMessage("genderId", fieldErrors.genderId);
  const dobError = getParticipantFieldErrorMessage("dob", fieldErrors.dob);
  const ndisNumberError = getParticipantFieldErrorMessage(
    "ndisNumber",
    fieldErrors.ndisNumber,
  );
  const emailError = getParticipantFieldErrorMessage("email", fieldErrors.email);
  const phoneNumberError = getParticipantFieldErrorMessage(
    "phoneNumber",
    fieldErrors.phoneNumber,
  );
  const pricingRegionError = getParticipantFieldErrorMessage(
    "pricingRegion",
    fieldErrors.pricingRegion,
  );
  const addressError = getParticipantFieldErrorMessage("address", fieldErrors.address);
  const unitBuildingError = getParticipantFieldErrorMessage(
    "unitBuilding",
    fieldErrors.unitBuilding,
  );
  const activeError = getParticipantFieldErrorMessage("active", fieldErrors.active);

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-900/25">
      <button
        type="button"
        aria-label="Close participant drawer"
        onClick={onClose}
        className="hidden flex-1 cursor-default md:block"
      />

      <div className="ml-auto flex h-full min-h-0 w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-lg text-slate-400 transition hover:text-slate-700"
            >
              X
            </button>
            <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
          </div>
        </div>

        <form
          onSubmit={(event) => void onSubmit(event)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid gap-4">
              <div>
                <label
                  className="text-sm font-medium text-slate-600"
                  htmlFor="clientFirstName"
                >
                  <span className="text-rose-500">*</span> First Name
                </label>
                <input
                  id="clientFirstName"
                  name="firstName"
                  placeholder="e.g., John"
                  value={formState.firstName}
                  onChange={onInputChange}
                  disabled={ro}
                  className={getParticipantFieldClass(firstNameError !== null)}
                />
                {firstNameError ? (
                  <p className="mt-2 text-xs text-rose-600">{firstNameError}</p>
                ) : null}
              </div>

              <div>
                <label
                  className="text-sm font-medium text-slate-600"
                  htmlFor="clientLastName"
                >
                  <span className="text-rose-500">*</span> Last Name
                </label>
                <input
                  id="clientLastName"
                  name="lastName"
                  placeholder="e.g., Doe"
                  value={formState.lastName}
                  onChange={onInputChange}
                  disabled={ro}
                  className={getParticipantFieldClass(lastNameError !== null)}
                />
                {lastNameError ? (
                  <p className="mt-2 text-xs text-rose-600">{lastNameError}</p>
                ) : null}
              </div>

              <div>
                <span
                  className="text-sm font-medium text-slate-600"
                  id="clientGenderLabel"
                >
                  <span className="text-rose-500">*</span> Gender
                </span>
                {canEditGenderSelect ? (
                  <>
                    <select
                      id="clientGender"
                      name="genderId"
                      aria-labelledby="clientGenderLabel"
                      value={formState.genderId}
                      onChange={onInputChange}
                      disabled={ro}
                      className={getParticipantFieldClass(genderError !== null)}
                    >
                      <option value="" disabled hidden />
                      {genders.map((gender) => (
                        <option key={gender.id} value={gender.id}>
                          {gender.label}
                        </option>
                      ))}
                    </select>
                    {genderError ? (
                      <p className="mt-2 text-xs text-rose-600">{genderError}</p>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-2">
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
                      {genderReadonlyLabel ?? `Gender ID ${formState.genderId}`}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Changing gender requires access to the genders catalogue.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label
                  className="text-sm font-medium text-slate-600"
                  htmlFor="clientDob"
                >
                  <span className="text-rose-500">*</span> Date of Birth
                </label>
                <input
                  id="clientDob"
                  name="dob"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={formState.dob}
                  onChange={onInputChange}
                  disabled={ro}
                  className={getParticipantFieldClass(dobError !== null)}
                />
                {dobError ? (
                  <p className="mt-2 text-xs text-rose-600">{dobError}</p>
                ) : null}
              </div>

              <div>
                <label
                  className="text-sm font-medium text-slate-600"
                  htmlFor="clientNdisNumber"
                >
                  <span className="text-rose-500">*</span> NDIS Number
                </label>
                <input
                  id="clientNdisNumber"
                  name="ndisNumber"
                  placeholder="e.g., 423143214"
                  value={formState.ndisNumber}
                  onChange={onInputChange}
                  inputMode="numeric"
                  pattern="\d{1,16}"
                  maxLength={NDIS_NUMBER_MAX_LENGTH}
                  disabled={ro}
                  className={getParticipantFieldClass(ndisNumberError !== null)}
                />
                {ndisNumberError ? (
                  <p className="mt-2 text-xs text-rose-600">{ndisNumberError}</p>
                ) : null}
              </div>

              <div>
                <label
                  className="text-sm font-medium text-slate-600"
                  htmlFor="clientEmail"
                >
                  <span className="text-rose-500">*</span> Email
                </label>
                <input
                  id="clientEmail"
                  name="email"
                  type="email"
                  placeholder="e.g., name@example.com"
                  value={formState.email}
                  onChange={onInputChange}
                  disabled={ro}
                  className={getParticipantFieldClass(emailError !== null)}
                />
                {emailError ? (
                  <p className="mt-2 text-xs text-rose-600">{emailError}</p>
                ) : null}
              </div>

              <div>
                <label
                  className="text-sm font-medium text-slate-600"
                  htmlFor="clientPhoneNumber"
                >
                  Phone Number
                </label>
                <input
                  id="clientPhoneNumber"
                  name="phoneNumber"
                  placeholder="e.g., 1800123456"
                  value={formState.phoneNumber}
                  onChange={onInputChange}
                  disabled={ro}
                  className={getParticipantFieldClass(phoneNumberError !== null)}
                />
                {phoneNumberError ? (
                  <p className="mt-2 text-xs text-rose-600">{phoneNumberError}</p>
                ) : null}
              </div>

              <div className="order-9">
                <span
                  className="text-sm font-medium text-slate-600"
                  id="clientPricingRegionLabel"
                >
                  <span className="text-rose-500">*</span> Pricing Region
                </span>
                {canEditPricingRegionSelect ? (
                  <>
                    <select
                      id="clientPricingRegion"
                      name="pricingRegion"
                      aria-labelledby="clientPricingRegionLabel"
                      value={formState.pricingRegion}
                      onChange={onInputChange}
                      disabled={ro}
                      className={getParticipantFieldClass(
                        pricingRegionError !== null,
                      )}
                    >
                      <option value="" disabled hidden />
                      {pricingRegionOptions.map((pricingRegion) => (
                        <option
                          key={pricingRegion.code}
                          value={pricingRegion.code}
                        >
                          {pricingRegion.code.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                    {pricingRegionError ? (
                      <p className="mt-2 text-xs text-rose-600">
                        {pricingRegionError}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-2">
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
                      {formState.pricingRegion === ""
                        ? "—"
                        : formState.pricingRegion.replaceAll("_", " ")}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Changing pricing region requires access to rate sets
                      (rate_sets.read).
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label
                  className="text-sm font-medium text-slate-600"
                  htmlFor="clientAddress"
                >
                  <span className="text-rose-500">*</span> Address
                </label>
                <textarea
                  id="clientAddress"
                  name="address"
                  value={formState.address}
                  onChange={onInputChange}
                  disabled={ro}
                  rows={3}
                  className={`${getParticipantFieldClass(addressError !== null)} resize-y`}
                />
                {addressError ? (
                  <p className="mt-2 text-xs text-rose-600">{addressError}</p>
                ) : null}
              </div>

              <div>
                <label
                  className="text-sm font-medium text-slate-600"
                  htmlFor="clientUnitBuilding"
                >
                  Unit / Building
                </label>
                <input
                  id="clientUnitBuilding"
                  name="unitBuilding"
                  value={formState.unitBuilding}
                  onChange={onInputChange}
                  disabled={ro}
                  className={getParticipantFieldClass(unitBuildingError !== null)}
                />
                {unitBuildingError ? (
                  <p className="mt-2 text-xs text-rose-600">
                    {unitBuildingError}
                  </p>
                ) : null}
              </div>

              <div className="order-10">
                <span className="text-sm font-medium text-slate-600">Active</span>
                <div className="mt-3 flex items-center gap-3">
                  <Toggle
                    checked={formState.active}
                    disabled={ro}
                    onChange={onActiveChange}
                  />
                  <span className="text-sm text-slate-500">
                    {formState.active ? "Active" : "Inactive"}
                  </span>
                </div>
                {activeError ? (
                  <p className="mt-2 text-xs text-rose-600">{activeError}</p>
                ) : null}
              </div>
            </div>

            {!ro && !canSaveParticipant && isCreatingParticipant ? (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                Adding a participant requires the genders catalogue (genders.read)
                and the pricing-region catalogue (rate_sets.read).
              </div>
            ) : null}

            {fieldErrors.form ? (
              <p className="mt-6 text-sm text-rose-600">{fieldErrors.form}</p>
            ) : null}

          </div>

          <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            {ro ? null : (
              <button
                type="submit"
                disabled={isSubmitting || !canSaveParticipant}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSubmitting ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export function ClientsManager() {
  const { session } = useAuthSession();
  const canWriteClients = Boolean(
    session?.user.permissions.includes("clients.write"),
  );
  const canDeleteClients = Boolean(
    session?.user.permissions.includes("clients.delete"),
  );
  const canReadGenders = Boolean(
    session?.user.permissions.includes("genders.read"),
  );
  const canReadRateSets = Boolean(
    session?.user.permissions.includes("rate_sets.read"),
  );

  const [clients, setClients] = useState<Client[]>([]);
  const [genders, setGenders] = useState<GenderOption[]>([]);
  const [pricingRegionCatalog, setPricingRegionCatalog] = useState<
    PricingRegionOption[]
  >([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [genderFilter, setGenderFilter] = useState("all");
  const [pricingRegionFilter, setPricingRegionFilter] = useState("all");
  const [statusFilter, setStatusFilter] =
    useState<ClientStatusFilter>("all");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerReadOnly, setDrawerReadOnly] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );
  const [formState, setFormState] = useState<ClientFormState>(DEFAULT_FORM_STATE);
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<keyof ClientFormState>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const genderLabelById = useMemo(
    () => new Map(genders.map((gender) => [String(gender.id), gender.label])),
    [genders],
  );

  const pricingRegionFilterOptions = useMemo((): PricingRegionOption[] => {
    if (canReadRateSets && pricingRegionCatalog.length > 0) {
      return pricingRegionCatalog;
    }

    return buildPricingRegionOptionsFromClients(clients);
  }, [canReadRateSets, pricingRegionCatalog, clients]);

  const showPricingRegionFilter = pricingRegionFilterOptions.length > 0;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    let clientsLoaded = false;

    try {
      const clientsData = await fetchApiData<ClientsResponse>("/api/clients");
      setClients(sortClients(clientsData.clients));
      clientsLoaded = true;
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to load participants."));
      setClients([]);
    }

    if (clientsLoaded && canReadGenders) {
      try {
        const gendersRows = await fetchApiData<GenderRow[]>(
          "/api/genders?status=active&limit=500&offset=0",
          undefined,
          { redirectOnForbidden: false },
        );
        setGenders(
          gendersRows.map((row) => ({
            id: row.id,
            code: row.code,
            label: row.label,
          })),
        );
      } catch {
        setGenders([]);
      }
    } else {
      setGenders([]);
    }

    if (clientsLoaded && canReadRateSets) {
      try {
        const pricingRegionsData = await fetchApiData<PricingRegionsResponse>(
          "/api/pricing-regions",
          undefined,
          { redirectOnForbidden: false },
        );
        setPricingRegionCatalog(pricingRegionsData.pricingRegions);
      } catch {
        setPricingRegionCatalog([]);
      }
    } else {
      setPricingRegionCatalog([]);
    }

    setIsLoading(false);
  }, [canReadGenders, canReadRateSets]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!canReadGenders) {
      setGenderFilter("all");
    }
  }, [canReadGenders]);

  useEffect(() => {
    const codes = new Set(
      pricingRegionFilterOptions.map((option) => option.code),
    );

    if (pricingRegionFilter !== "all" && !codes.has(pricingRegionFilter)) {
      setPricingRegionFilter("all");
    }
  }, [pricingRegionFilterOptions, pricingRegionFilter]);

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => {
      setSearchQuery(searchInput.trim().toLowerCase());
    }, 250);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, genderFilter, pricingRegionFilter, statusFilter, pageSize]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [successMessage]);

  useEffect(() => {
    if (!submitError) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      setSubmitError(null);
    }, 4000);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [submitError]);

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

  function resetForm() {
    setFormState(DEFAULT_FORM_STATE);
    setEditingClientId(null);
    setDrawerReadOnly(false);
    setFieldErrors({});
    setSubmitError(null);
  }

  function closeDrawer() {
    setIsDrawerOpen(false);
    resetForm();
  }

  function openCreateDrawer() {
    if (!canWriteClients) {
      return;
    }
    resetForm();
    setSuccessMessage(null);
    setIsDrawerOpen(true);
  }

  function openEditDrawer(client: Client) {
    setEditingClientId(client.id);
    setFormState(toFormState(client));
    setFieldErrors({});
    setSubmitError(null);
    setSuccessMessage(null);
    setDrawerReadOnly(!canWriteClients);
    setIsDrawerOpen(true);
  }

  function openDeleteConfirmPopover(
    client: Client,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    if (!canDeleteClients) {
      return;
    }
    setDeleteConfirm({
      client,
      anchorRect: event.currentTarget.getBoundingClientRect(),
    });
    setSubmitError(null);
    setSuccessMessage(null);
  }

  function handleInputChange(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = event.target;
    const normalizedValue =
      name === "ndisNumber"
        ? value.replaceAll(/\D+/g, "").slice(0, NDIS_NUMBER_MAX_LENGTH)
        : value;
    const emailValidationMessage =
      name === "email" ? getParticipantEmailValidationMessage(normalizedValue) : null;

    setFormState((current) => ({
      ...current,
      [name]: normalizedValue,
    }));
    setFieldErrors((current) => ({
      ...current,
      [name]: emailValidationMessage ?? undefined,
      form: undefined,
    }));
    setSubmitError(null);
  }

  function handleActiveChange(checked: boolean) {
    setFormState((current) => ({
      ...current,
      active: checked,
    }));
    setFieldErrors((current) => ({
      ...current,
      active: undefined,
      form: undefined,
    }));
    setSubmitError(null);
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (drawerReadOnly) {
      return;
    }
    const emailValidationMessage = getParticipantEmailValidationMessage(formState.email);

    if (emailValidationMessage !== null) {
      setFieldErrors((current) => ({
        ...current,
        email: emailValidationMessage,
      }));
      setSubmitError(null);
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(null);
    setSuccessMessage(null);

    try {
      const payload = toRequestPayload(formState);
      const isEditing = editingClientId !== null;
      const endpoint = isEditing
        ? `/api/clients/${editingClientId}`
        : "/api/clients";
      const method = isEditing ? "PATCH" : "POST";
      const data = await fetchApiData<ClientRow>(endpoint, {
        method,
        body: JSON.stringify(payload),
      });
      const mapped = mapClientRow(data);

      setClients((current) => {
        const previous = isEditing
          ? current.find((c) => c.id === mapped.id)
          : undefined;
        const fromCatalog = genders.find(
          (g) => String(g.id) === String(mapped.genderId),
        );
        const merged: Client = {
          ...mapped,
          genderLabel:
            mapped.genderLabel ??
            fromCatalog?.label ??
            previous?.genderLabel ??
            null,
        };

        const nextClients = isEditing
          ? current.map((row) => (row.id === data.id ? merged : row))
          : [...current, merged];

        return sortClients(nextClients);
      });

      closeDrawer();

      const nextSuccessMessage = isEditing
        ? "Participant updated successfully."
        : "Participant created successfully.";
      setSuccessMessage(nextSuccessMessage);
    } catch (error) {
      const nextFieldErrors = getRequestFieldErrors<keyof ClientFormState>(error);
      setFieldErrors(nextFieldErrors);

      const hasInlineErrors = Object.keys(nextFieldErrors).some(
        (key) => key !== "form",
      );

      if (error instanceof ApiRequestError && error.code === "VALIDATION_ERROR" && hasInlineErrors) {
        setSubmitError(null);
      } else {
        setSubmitError(getRequestErrorMessage(error, "Failed to save participant."));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(client: Client) {
    setDeletingClientId(client.id);
    setDeleteConfirm(null);
    setSubmitError(null);
    setSuccessMessage(null);

    try {
      await fetchApiData<{ client: { id: string; deletedAt: string } }>(
        `/api/clients/${client.id}`,
        {
          method: "DELETE",
        },
      );

      setClients((current) =>
        current.filter((currentClient) => currentClient.id !== client.id),
      );

      if (editingClientId === client.id) {
        closeDrawer();
      }

      setSuccessMessage("Participant deleted successfully.");
    } catch (error) {
      setSubmitError(getRequestErrorMessage(error, "Failed to delete participant."));
    } finally {
      setDeletingClientId(null);
    }
  }

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      const matchesSearch =
        !searchQuery || getClientSearchText(client).includes(searchQuery);
      const matchesGender =
        genderFilter === "all" || String(client.genderId) === genderFilter;
      const matchesPricingRegion =
        pricingRegionFilter === "all" ||
        client.pricingRegion === pricingRegionFilter;
      const matchesStatus =
        statusFilter === "all" || getClientStatus(client) === statusFilter;

      return (
        matchesSearch &&
        matchesGender &&
        matchesPricingRegion &&
        matchesStatus
      );
    });
  }, [clients, genderFilter, pricingRegionFilter, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedClients = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return filteredClients.slice(startIndex, startIndex + pageSize);
  }, [filteredClients, pageSize, safeCurrentPage]);

  const hasGenderCatalogForForms = canReadGenders && genders.length > 0;
  const hasPricingRegionCatalog =
    canReadRateSets && pricingRegionCatalog.length > 0;
  const isEditingParticipant = editingClientId !== null;
  // Edits use clients.write only: gender stays unchanged without genders.read (readonly UI).
  const canSaveParticipant = isEditingParticipant
    ? formState.pricingRegion.trim() !== ""
    : hasGenderCatalogForForms && hasPricingRegionCatalog;
  const canEditGenderSelect = hasGenderCatalogForForms;
  const canEditPricingRegionSelect = hasPricingRegionCatalog;
  const canAddParticipant =
    canWriteClients &&
    hasGenderCatalogForForms &&
    hasPricingRegionCatalog;

  const editingParticipant = useMemo(() => {
    if (editingClientId === null) {
      return undefined;
    }

    return clients.find((c) => c.id === editingClientId);
  }, [clients, editingClientId]);

  const genderReadonlyLabelForDrawer =
    editingParticipant === undefined
      ? null
      : formatClientGenderDisplay(editingParticipant, genderLabelById);

  let drawerTitle = "Edit Participant";
  if (editingClientId === null) {
    drawerTitle = "Add Participant";
  } else if (drawerReadOnly) {
    drawerTitle = "View Participant";
  }
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

  return (
    <div className="mx-auto w-full max-w-7xl">
      {successMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed top-6 left-1/2 z-200 flex max-w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 justify-center px-4"
        >
          <div className="pointer-events-auto rounded-xl border border-white/25 bg-[rgb(18,185,129)] px-5 py-3 text-sm font-medium text-white shadow-lg">
            {successMessage}
          </div>
        </div>
      ) : null}

      {submitError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="pointer-events-none fixed top-6 left-1/2 z-200 flex max-w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 justify-center px-4"
        >
          <div className="pointer-events-auto rounded-xl border border-white/25 bg-rose-600 px-5 py-3 text-sm font-medium text-white shadow-lg">
            {submitError}
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
            Participants
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage participant records.
          </p>
          {!canWriteClients ? (
            <p className="mt-2 text-sm text-slate-500">
              You have read-only access; add, edit, and delete require the
              corresponding client permissions.
            </p>
          ) : null}
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateDrawer}
              disabled={!canAddParticipant}
              title={
                !canWriteClients
                  ? "You need clients.write to add participants."
                  : !canAddParticipant
                    ? !hasGenderCatalogForForms
                      ? "Adding participants requires the genders catalogue (genders.read)."
                      : "Adding participants requires the pricing-region catalogue (rate_sets.read)."
                    : undefined
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Add Participant
            </button>
          </div>

          {loadError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {loadError}
            </div>
          ) : null}

          {!isLoading && (!canReadGenders || !canReadRateSets) ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              <ul className="list-disc space-y-1 pl-5">
                {!canReadRateSets ? (
                  <li>
                    Without rate_sets.read, the pricing region filter lists only
                    regions that appear on loaded participants.
                    {canWriteClients
                      ? " Adding a new participant still requires the full pricing-region catalogue."
                      : ""}
                  </li>
                ) : null}
                {!canReadGenders ? (
                  <li>
                    Adding new participants requires the genders catalogue
                    (genders.read). You can still view the list
                    {canWriteClients
                      ? " and edit existing participants without changing gender."
                      : "."}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div
            className={
              (() => {
                const colCount =
                  2 +
                  (canReadGenders ? 1 : 0) +
                  (showPricingRegionFilter ? 1 : 0);

                if (colCount === 4) {
                  return "mt-5 grid gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] md:items-end";
                }

                if (colCount === 3) {
                  return "mt-5 grid gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] md:items-end";
                }

                return "mt-5 grid gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)] md:items-end";
              })()
            }
          >
            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="clientSearch"
              >
                First Name, Last Name, NDIS number, Email
              </label>
              <input
                id="clientSearch"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search first name, last name, NDIS number or email"
                className={FIELD_INPUT_CLASS_NAME}
              />
            </div>

            {canReadGenders ? (
              <div>
                <label
                  className="text-sm font-medium text-slate-500"
                  htmlFor="clientGenderFilter"
                >
                  Gender
                </label>
                <select
                  id="clientGenderFilter"
                  value={genderFilter}
                  onChange={(event) => setGenderFilter(event.target.value)}
                  className={FIELD_INPUT_CLASS_NAME}
                >
                  <option value="all">All genders</option>
                  {genders.map((gender) => (
                    <option key={gender.id} value={gender.id}>
                      {gender.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {showPricingRegionFilter ? (
              <div>
                <label
                  className="text-sm font-medium text-slate-500"
                  htmlFor="clientPricingRegionFilter"
                >
                  Pricing Region
                </label>
                <select
                  id="clientPricingRegionFilter"
                  value={pricingRegionFilter}
                  onChange={(event) =>
                    setPricingRegionFilter(event.target.value)
                  }
                  className={FIELD_INPUT_CLASS_NAME}
                >
                  <option value="all">All pricing regions</option>
                  {pricingRegionFilterOptions.map((pricingRegion) => (
                    <option
                      key={pricingRegion.code}
                      value={pricingRegion.code}
                    >
                      {pricingRegion.code.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="clientStatusFilter"
              >
                Active
              </label>
              <select
                id="clientStatusFilter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as ClientStatusFilter)
                }
                className={FIELD_INPUT_CLASS_NAME}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="relative mt-4 overflow-x-auto">
            <table className="min-w-[1400px] whitespace-nowrap text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">First Name</th>
                  <th className="px-3 py-3 font-semibold">Last Name</th>
                  <th className="px-3 py-3 font-semibold">Gender</th>
                  <th className="px-3 py-3 font-semibold">Date of Birth</th>
                  <th className="px-3 py-3 font-semibold">NDIS Number</th>
                  <th className="px-3 py-3 font-semibold">Email</th>
                  <th className="px-3 py-3 font-semibold">Phone Number</th>
                  <th className="px-3 py-3 font-semibold">Address</th>
                  <th className="px-3 py-3 font-semibold">Unit/Building</th>
                  <th className="px-3 py-3 font-semibold">Pricing Region</th>
                  <th className="px-3 py-3 font-semibold">Active</th>
                  <th className="sticky right-0 z-10 border-l border-slate-200 bg-white px-3 py-3 font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-3 py-10 text-center text-sm text-slate-500"
                    >
                      Loading participants...
                    </td>
                  </tr>
                ) : null}

                {!isLoading && paginatedClients.length === 0 ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-3 py-10 text-center text-sm text-slate-500"
                    >
                      No participants found for the current filters.
                    </td>
                  </tr>
                ) : null}

                {paginatedClients.map((client) => (
                  <tr key={client.id} className="group transition hover:bg-slate-50">
                    <td className="px-3 py-4 text-slate-900">{client.firstName}</td>
                    <td className="px-3 py-4 text-slate-900">{client.lastName}</td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatClientGenderDisplay(client, genderLabelById)}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatDate(client.dob)}
                    </td>
                    <td className="px-3 py-4 text-slate-700">{client.ndisNumber}</td>
                    <td className="px-3 py-4 text-slate-700">{client.email}</td>
                    <td className="px-3 py-4 text-slate-700">
                      {client.phoneNumber || "-"}
                    </td>
                    <td className="px-3 py-4 text-slate-700">{client.address}</td>
                    <td className="px-3 py-4 text-slate-700">
                      {client.unitBuilding || "-"}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {client.pricingRegion.replaceAll("_", " ")}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      <ActiveStatusIcon active={client.deactivatedAt === null} />
                    </td>
                    <td className="sticky right-0 z-10 min-w-40 border-l border-slate-100 bg-white px-3 py-4 group-hover:bg-slate-50">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditDrawer(client)}
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          {canWriteClients ? "Edit" : "View"}
                        </button>
                        <button
                          type="button"
                          data-delete-trigger
                          onClick={(event) => openDeleteConfirmPopover(client, event)}
                          disabled={!canDeleteClients || deletingClientId === client.id}
                          title={
                            !canDeleteClients
                              ? "You need clients.delete to remove participants."
                              : undefined
                          }
                          className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingClientId === client.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PaginationControls
            currentPage={safeCurrentPage}
            pageSize={pageSize}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      </section>

      <ParticipantDrawer
        fieldErrors={fieldErrors}
        formState={formState}
        genders={genders}
        canSaveParticipant={canSaveParticipant}
        canEditGenderSelect={canEditGenderSelect}
        genderReadonlyLabel={genderReadonlyLabelForDrawer}
        canEditPricingRegionSelect={canEditPricingRegionSelect}
        isOpen={isDrawerOpen}
        isSubmitting={isSubmitting}
        onClose={closeDrawer}
        onInputChange={handleInputChange}
        onActiveChange={handleActiveChange}
        onSubmit={handleSubmit}
        pricingRegionOptions={pricingRegionFilterOptions}
        readOnly={drawerReadOnly}
        isCreatingParticipant={editingClientId === null}
        title={drawerTitle}
      />

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
                    Delete Participant
                  </p>
                  <p className="mt-3 text-[15px] text-slate-700">
                    This action cannot be undone.
                  </p>

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      disabled={deletingClientId === deleteConfirm.client.id}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(deleteConfirm.client)}
                      disabled={
                        !canDeleteClients ||
                        deletingClientId === deleteConfirm.client.id
                      }
                      className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingClientId === deleteConfirm.client.id
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
