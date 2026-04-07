"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  InvoiceDetailResponse,
  InvoiceListRow,
  InvoicePdfExtractLinePayload,
  InvoicePdfExtractResponse,
  SelectOptionRow,
} from "@/modules/invoice/types";
import {
  ApiRequestError,
  fetchApiData,
  fetchApiListWithPagination,
  fetchInvoiceNumberExists,
  getRequestErrorMessage,
  getRequestFieldErrors,
  type FieldErrors,
} from "@/lib/client/api";
import { useAuthSession } from "@/modules/auth/components/AuthSessionProvider";

const INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500";

const READONLY_INPUT_CLASS_NAME =
  "mt-2 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none";

/** Debounce service-date → rate-set API lookups to avoid a request per calendar click. */
const RATE_SET_DATE_DEBOUNCE_MS = 320;

type LookupOption = { id: number; label: string };

type InvoiceLineForm = {
  key: string;
  start_date: string;
  end_date: string;
  rate_set_id: number | "";
  category_id: number | "";
  support_item_id: number | "";
  max_rate: string;
  unit: string;
  input_rate: string;
  categories: LookupOption[];
  supportItems: LookupOption[];
  rateSetMessage: string | null;
  loadingRateSet: boolean;
  loadingMaxRate: boolean;
};

function mapExtractedLineToForm(
  line: InvoicePdfExtractLinePayload,
): InvoiceLineForm {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()),
    start_date: line.start_date,
    end_date: line.end_date,
    rate_set_id: line.rate_set_id ?? "",
    category_id: line.category_id ?? "",
    support_item_id: line.support_item_id ?? "",
    max_rate: line.max_rate ?? "",
    unit: line.unit ?? "",
    input_rate: line.input_rate ?? "",
    categories: line.categories,
    supportItems: line.supportItems,
    rateSetMessage: line.rate_set_message,
    loadingRateSet: false,
    loadingMaxRate: false,
  };
}

function newLine(): InvoiceLineForm {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()),
    start_date: "",
    end_date: "",
    rate_set_id: "",
    category_id: "",
    support_item_id: "",
    max_rate: "",
    unit: "",
    input_rate: "",
    categories: [],
    supportItems: [],
    rateSetMessage: null,
    loadingRateSet: false,
    loadingMaxRate: false,
  };
}

function round2(n: number): string {
  return (Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100).toFixed(2);
}

function lineInvoicedAmount(line: InvoiceLineForm): string {
  const u = Number.parseFloat(line.unit);
  const r = Number.parseFloat(line.input_rate);

  if (!Number.isFinite(u) || !Number.isFinite(r)) {
    return "";
  }

  return round2(u * r);
}

function getInvoiceLineDateRangeError(line: InvoiceLineForm): string | null {
  if (
    line.start_date !== "" &&
    line.end_date !== "" &&
    line.end_date < line.start_date
  ) {
    return "Service End Date cannot be earlier than Service Start Date.";
  }

  return null;
}

function getInvoiceLineInputRateError(line: InvoiceLineForm): string | null {
  if (line.input_rate.trim() === "" || line.max_rate.trim() === "") {
    return null;
  }

  const inputRate = Number.parseFloat(line.input_rate);
  const maxRate = Number.parseFloat(line.max_rate);

  if (!Number.isFinite(inputRate) || !Number.isFinite(maxRate)) {
    return null;
  }

  return inputRate > maxRate
    ? "Invoiced Rate must be less than or equal to Max Rate."
    : null;
}

function formatInvoiceDateUtc(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

function formatAmountCell(value: string | null): string {
  if (value === null || value === "") {
    return "—";
  }

  const n = Number.parseFloat(value);

  if (!Number.isFinite(n)) {
    return value;
  }

  return n.toFixed(2);
}

function toDateInputValue(value: string | null): string {
  if (value === null || value === "") {
    return "";
  }

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

function toMoneyInputValue(value: string | null): string {
  if (value === null || value === "") {
    return "";
  }

  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? String(parsed) : value;
}

type RateSetLookupResponse = {
  rate_set_ids: number[];
  rate_set_id: number | null;
  ambiguous: boolean;
};

type MaxRateLookupResponse = {
  unit_price: string | null;
  match_count: number;
  ambiguous?: boolean;
};

export function InvoicesManager() {
  const { session } = useAuthSession();
  const canWriteInvoices = Boolean(
    session?.user.permissions.includes("invoices.write"),
  );
  const canDeleteInvoices = Boolean(
    session?.user.permissions.includes("invoices.delete"),
  );

  const [invoices, setInvoices] = useState<InvoiceListRow[]>([]);
  const [invoiceNumberInput, setInvoiceNumberInput] = useState("");
  const [invoiceNumberSearch, setInvoiceNumberSearch] = useState("");
  const [clientIdFilter, setClientIdFilter] = useState<string>("all");
  const [providerIdFilter, setProviderIdFilter] = useState<string>("all");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [clientOptions, setClientOptions] = useState<SelectOptionRow[]>([]);
  const [providerOptions, setProviderOptions] = useState<SelectOptionRow[]>([]);
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerReadOnly, setDrawerReadOnly] = useState(false);
  const [saveSubmitting, setSaveSubmitting] = useState(false);
  const [loadingEditId, setLoadingEditId] = useState<number | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);
  const [editingInvoiceStatus, setEditingInvoiceStatus] = useState<
    "drafted" | "completed" | null
  >(null);
  const [formClientId, setFormClientId] = useState("");
  const [formProviderId, setFormProviderId] = useState("");
  const [formInvoiceNumber, setFormInvoiceNumber] = useState("");
  const [formInvoiceDate, setFormInvoiceDate] = useState("");
  const [formExpectedAmount, setFormExpectedAmount] = useState("");
  const [lines, setLines] = useState<InvoiceLineForm[]>([]);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerFieldErrors, setDrawerFieldErrors] =
    useState<FieldErrors<string>>({});
  const [pdfImportLoading, setPdfImportLoading] = useState(false);
  const [pdfImportWarnings, setPdfImportWarnings] = useState<string[] | null>(
    null,
  );
  const pdfFileInputRef = useRef<HTMLInputElement | null>(null);
  const rateSetDateDebounceTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const rateSetDatePendingLineRef = useRef<Map<string, InvoiceLineForm>>(
    new Map(),
  );
  const rateSetResolveSeqByLineKeyRef = useRef<Map<string, number>>(new Map());
  const rateSetLookupEpochRef = useRef(0);

  const selectedPricingRegion = useMemo(() => {
    if (formClientId === "") {
      return "";
    }

    const c = clientOptions.find((x) => String(x.id) === formClientId);

    return c?.pricing_region ?? "";
  }, [clientOptions, formClientId]);

  const derivedInvoiceTotal = useMemo(() => {
    let sum = 0;
    let any = false;

    for (const line of lines) {
      const a = lineInvoicedAmount(line);

      if (a !== "") {
        any = true;
        sum += Number.parseFloat(a);
      }
    }

    return any ? round2(sum) : "";
  }, [lines]);

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => {
      setInvoiceNumberSearch(invoiceNumberInput.trim());
    }, 250);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [invoiceNumberInput]);

  useEffect(() => {
    setCurrentPage(1);
  }, [invoiceNumberSearch, clientIdFilter, providerIdFilter, invoiceDate, pageSize]);

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
    if (!drawerError) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      setDrawerError(null);
    }, 4000);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [drawerError]);

  useEffect(() => {
    void (async () => {
      let clients: SelectOptionRow[] = [];
      let providers: SelectOptionRow[] = [];

      try {
        clients = await fetchApiData<SelectOptionRow[]>(
          "/api/clients/options",
          undefined,
          { redirectOnForbidden: false },
        );
      } catch {
        clients = [];
      }

      try {
        providers = await fetchApiData<SelectOptionRow[]>(
          "/api/providers/options",
          undefined,
          { redirectOnForbidden: false },
        );
      } catch {
        providers = [];
      }

      setClientOptions(clients);
      setProviderOptions(providers);
      setOptionsError(
        clients.length === 0 && providers.length === 0
          ? "Failed to load filter options."
          : null,
      );
    })();
  }, []);

  const loadInvoices = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String((currentPage - 1) * pageSize));

      if (invoiceNumberSearch !== "") {
        params.set("invoice_number", invoiceNumberSearch);
      }

      if (clientIdFilter !== "all") {
        params.set("client_id", clientIdFilter);
      }

      if (providerIdFilter !== "all") {
        params.set("provider_id", providerIdFilter);
      }

      if (invoiceDate.trim() !== "") {
        params.set("invoice_date", invoiceDate.trim());
      }

      const endpoint = `/api/invoices?${params.toString()}`;
      const { data: rows, pagination } =
        await fetchApiListWithPagination<InvoiceListRow>(endpoint);

      setInvoices(rows);
      setListTotal(pagination.total);

      const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize));
      setCurrentPage((page) => Math.min(page, totalPages));
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to load invoices."));
    } finally {
      setIsLoading(false);
    }
  }, [
    invoiceNumberSearch,
    clientIdFilter,
    providerIdFilter,
    invoiceDate,
    pageSize,
    currentPage,
  ]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    if (selectedPricingRegion === "") {
      setLines((prev) =>
        prev.map((l) =>
          l.support_item_id !== "" || l.max_rate !== ""
            ? { ...l, max_rate: "", loadingMaxRate: false }
            : l,
        ),
      );

      return;
    }

    lines.forEach((line, index) => {
      if (
        line.rate_set_id !== "" &&
        line.support_item_id !== "" &&
        line.start_date &&
        line.end_date
      ) {
        void loadMaxRateForLine(index, line);
      }
    });
    // Intentionally when drawer/region opens or changes — not on every line keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen, selectedPricingRegion]);

  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  function cancelInvoiceDrawerRateSetLookups() {
    for (const t of rateSetDateDebounceTimersRef.current.values()) {
      clearTimeout(t);
    }

    rateSetDateDebounceTimersRef.current.clear();
    rateSetDatePendingLineRef.current.clear();
    rateSetResolveSeqByLineKeyRef.current.clear();
    rateSetLookupEpochRef.current += 1;
  }

  function cancelRateSetLookupForLineKey(lineKey: string) {
    const timers = rateSetDateDebounceTimersRef.current;
    const pending = rateSetDatePendingLineRef.current;
    const seqMap = rateSetResolveSeqByLineKeyRef.current;
    const existing = timers.get(lineKey);

    if (existing !== undefined) {
      clearTimeout(existing);
      timers.delete(lineKey);
    }

    pending.delete(lineKey);
    seqMap.set(lineKey, (seqMap.get(lineKey) ?? 0) + 1);
  }

  function bumpRateSetResolveSeq(lineKey: string): number {
    const m = rateSetResolveSeqByLineKeyRef.current;
    const next = (m.get(lineKey) ?? 0) + 1;
    m.set(lineKey, next);

    return next;
  }

  function isStaleRateSetResolve(
    lineKey: string,
    epoch: number,
    seq: number,
  ): boolean {
    if (rateSetLookupEpochRef.current !== epoch) {
      return true;
    }

    return rateSetResolveSeqByLineKeyRef.current.get(lineKey) !== seq;
  }

  function scheduleResolveRateSetForLineKey(
    lineKey: string,
    line: InvoiceLineForm,
  ) {
    rateSetDatePendingLineRef.current.set(lineKey, line);
    const timers = rateSetDateDebounceTimersRef.current;
    const existing = timers.get(lineKey);

    if (existing !== undefined) {
      clearTimeout(existing);
    }

    // Invalidate any in-flight lookup so a slower response cannot win over newer dates.
    bumpRateSetResolveSeq(lineKey);

    const id = setTimeout(() => {
      timers.delete(lineKey);
      const snap = rateSetDatePendingLineRef.current.get(lineKey);
      rateSetDatePendingLineRef.current.delete(lineKey);

      if (snap !== undefined) {
        void resolveRateSetForLineKey(lineKey, snap);
      }
    }, RATE_SET_DATE_DEBOUNCE_MS);

    timers.set(lineKey, id);
  }

  function openAddDrawer() {
    if (!canWriteInvoices) {
      return;
    }
    cancelInvoiceDrawerRateSetLookups();
    setEditingInvoiceId(null);
    setEditingInvoiceStatus(null);
    setDrawerReadOnly(false);
    setFormClientId("");
    setFormProviderId("");
    setFormInvoiceNumber("");
    setFormInvoiceDate("");
    setFormExpectedAmount("");
    setLines([]);
    setDrawerError(null);
    setDrawerFieldErrors({});
    setPdfImportWarnings(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    cancelInvoiceDrawerRateSetLookups();
    setDrawerOpen(false);
    setEditingInvoiceId(null);
    setEditingInvoiceStatus(null);
    setDrawerReadOnly(false);
    setLoadingEditId(null);
    setSaveSubmitting(false);
    setDrawerError(null);
    setDrawerFieldErrors({});
    setPdfImportWarnings(null);
  }

  async function openEditDrawer(invoiceId: number) {
    cancelInvoiceDrawerRateSetLookups();
    setLoadingEditId(invoiceId);
    setDrawerError(null);
    setDrawerFieldErrors({});
    setPdfImportWarnings(null);

    try {
      const detail = await fetchApiData<InvoiceDetailResponse>(`/api/invoices/${invoiceId}`);
      const nextLines = await Promise.all(
        detail.items.map(async (item) => {
          const rateSetId = item.rate_set_id ?? "";
          const categoryId = item.category_id ?? "";
          const categories =
            rateSetId === ""
              ? []
              : await fetchApiData<LookupOption[]>(
                  `/api/invoices/lookup/categories?rate_set_id=${rateSetId}`,
                );
          const supportItems =
            categoryId === ""
              ? []
              : await fetchApiData<LookupOption[]>(
                  `/api/invoices/lookup/support-items?category_id=${categoryId}`,
                );

          return {
            key:
              globalThis.crypto?.randomUUID?.() ??
              String(Date.now() + Math.random()),
            start_date: toDateInputValue(item.start_date),
            end_date: toDateInputValue(item.end_date),
            rate_set_id: rateSetId,
            category_id: categoryId,
            support_item_id: item.support_item_id ?? "",
            max_rate: toMoneyInputValue(item.max_rate),
            unit: toMoneyInputValue(item.unit),
            input_rate: toMoneyInputValue(item.input_rate),
            categories,
            supportItems,
            rateSetMessage: null,
            loadingRateSet: false,
            loadingMaxRate: false,
          } satisfies InvoiceLineForm;
        }),
      );

      setEditingInvoiceId(invoiceId);
      setEditingInvoiceStatus(
        detail.invoice.status === "drafted" ? "drafted" : "completed",
      );
      setFormClientId(String(detail.invoice.client_id));
      setFormProviderId(String(detail.invoice.provider_id));
      setFormInvoiceNumber(detail.invoice.invoice_number);
      setFormInvoiceDate(toDateInputValue(detail.invoice.invoice_date));
      setFormExpectedAmount(toMoneyInputValue(detail.invoice.expected_amount));
      setLines(nextLines);
      setDrawerReadOnly(!canWriteInvoices);
      setDrawerOpen(true);
    } catch (error) {
      setDrawerError(getRequestErrorMessage(error, "Failed to load invoice."));
    } finally {
      setLoadingEditId(null);
    }
  }

  async function resolveRateSetForLineKey(
    lineKey: string,
    line: InvoiceLineForm,
  ) {
    const epoch = rateSetLookupEpochRef.current;
    const seq = rateSetResolveSeqByLineKeyRef.current.get(lineKey) ?? 0;

    if (
      !line.start_date ||
      !line.end_date ||
      line.start_date > line.end_date
    ) {
      if (isStaleRateSetResolve(lineKey, epoch, seq)) {
        return;
      }

      setLines((prev) => {
        const i = prev.findIndex((l) => l.key === lineKey);

        if (i === -1) {
          return prev;
        }

        return prev.map((l, j) =>
          j === i
            ? {
                ...l,
                rate_set_id: "",
                rateSetMessage: null,
                categories: [],
                category_id: "",
                supportItems: [],
                support_item_id: "",
                max_rate: "",
                loadingRateSet: false,
              }
            : l,
        );
      });

      return;
    }

    if (isStaleRateSetResolve(lineKey, epoch, seq)) {
      return;
    }

    setLines((prev) => {
      const i = prev.findIndex((l) => l.key === lineKey);

      if (i === -1) {
        return prev;
      }

      return prev.map((l, j) =>
        j === i ? { ...l, loadingRateSet: true, rateSetMessage: null } : l,
      );
    });

    try {
      const params = new URLSearchParams({
        start_date: line.start_date,
        end_date: line.end_date,
      });
      const data = await fetchApiData<RateSetLookupResponse>(
        `/api/invoices/lookup/rate-set?${params.toString()}`,
      );

      if (isStaleRateSetResolve(lineKey, epoch, seq)) {
        return;
      }

      if (data.rate_set_ids.length === 0) {
        setLines((prev) => {
          const i = prev.findIndex((l) => l.key === lineKey);

          if (i === -1) {
            return prev;
          }

          return prev.map((l, j) =>
            j === i
              ? {
                  ...l,
                  rate_set_id: "",
                  rateSetMessage: "No rate set matches these service dates.",
                  categories: [],
                  category_id: "",
                  supportItems: [],
                  support_item_id: "",
                  max_rate: "",
                  loadingRateSet: false,
                }
              : l,
          );
        });

        return;
      }

      if (data.rate_set_ids.length >= 2 || data.ambiguous) {
        setLines((prev) => {
          const i = prev.findIndex((l) => l.key === lineKey);

          if (i === -1) {
            return prev;
          }

          return prev.map((l, j) =>
            j === i
              ? {
                  ...l,
                  rate_set_id: "",
                  rateSetMessage: "Multiple rate sets match; adjust dates.",
                  categories: [],
                  category_id: "",
                  supportItems: [],
                  support_item_id: "",
                  max_rate: "",
                  loadingRateSet: false,
                }
              : l,
          );
        });

        return;
      }

      const rsId = data.rate_set_id!;

      const categories = await fetchApiData<LookupOption[]>(
        `/api/invoices/lookup/categories?rate_set_id=${rsId}`,
      );

      if (isStaleRateSetResolve(lineKey, epoch, seq)) {
        return;
      }

      setLines((prev) => {
        const i = prev.findIndex((l) => l.key === lineKey);

        if (i === -1) {
          return prev;
        }

        return prev.map((l, j) =>
          j === i
            ? {
                ...l,
                rate_set_id: rsId,
                rateSetMessage: null,
                categories,
                category_id: "",
                supportItems: [],
                support_item_id: "",
                max_rate: "",
                loadingRateSet: false,
              }
            : l,
        );
      });
    } catch {
      if (isStaleRateSetResolve(lineKey, epoch, seq)) {
        return;
      }

      setLines((prev) => {
        const i = prev.findIndex((l) => l.key === lineKey);

        if (i === -1) {
          return prev;
        }

        return prev.map((l, j) =>
          j === i
            ? {
                ...l,
                loadingRateSet: false,
                rateSetMessage: "Could not resolve rate set.",
              }
            : l,
        );
      });
    }
  }

  async function loadSupportItemsForLine(index: number, categoryId: number) {
    try {
      const supportItems = await fetchApiData<LookupOption[]>(
        `/api/invoices/lookup/support-items?category_id=${categoryId}`,
      );

      setLines((prev) =>
        prev.map((l, i) =>
          i === index ? { ...l, supportItems, support_item_id: "", max_rate: "" } : l,
        ),
      );
    } catch {
      /* ignore */
    }
  }

  async function loadMaxRateForLine(index: number, line: InvoiceLineForm) {
    if (
      line.rate_set_id === "" ||
      line.support_item_id === "" ||
      !line.start_date ||
      !line.end_date ||
      selectedPricingRegion === ""
    ) {
      setLines((prev) =>
        prev.map((l, i) => (i === index ? { ...l, max_rate: "", loadingMaxRate: false } : l)),
      );

      return;
    }

    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, loadingMaxRate: true } : l)),
    );

    try {
      const params = new URLSearchParams({
        rate_set_id: String(line.rate_set_id),
        support_item_id: String(line.support_item_id),
        start_date: line.start_date,
        end_date: line.end_date,
        pricing_region: selectedPricingRegion,
      });
      const data = await fetchApiData<MaxRateLookupResponse>(
        `/api/invoices/lookup/max-rate?${params.toString()}`,
      );

      if (data.unit_price === null || data.ambiguous || data.match_count !== 1) {
        setLines((prev) =>
          prev.map((l, i) =>
            i === index ? { ...l, max_rate: "", loadingMaxRate: false } : l,
          ),
        );

        return;
      }

      setLines((prev) =>
        prev.map((l, i) =>
          i === index
            ? { ...l, max_rate: data.unit_price!, loadingMaxRate: false }
            : l,
        ),
      );
    } catch {
      setLines((prev) =>
        prev.map((l, i) => (i === index ? { ...l, max_rate: "", loadingMaxRate: false } : l)),
      );
    }
  }

  function updateLine(index: number, patch: Partial<InvoiceLineForm>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }

  function clearItemFieldErrors() {
    setDrawerFieldErrors((previous) => {
      const nextErrors: FieldErrors<string> = {};

      for (const [key, value] of Object.entries(previous)) {
        if (!key.startsWith("items[")) {
          nextErrors[key] = value;
        }
      }

      return nextErrors;
    });
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
    clearItemFieldErrors();
  }

  function duplicateLine(index: number) {
    setLines((prev) => {
      const src = prev[index];

      if (!src) {
        return prev;
      }

      const copy: InvoiceLineForm = {
        ...src,
        key:
          globalThis.crypto?.randomUUID?.() ??
          String(Date.now() + Math.random()),
      };

      const next = [...prev];
      next.splice(index + 1, 0, copy);

      return next;
    });
    clearItemFieldErrors();
  }

  function removeLine(index: number) {
    setLines((prev) => {
      const victim = prev[index];

      if (victim) {
        cancelRateSetLookupForLineKey(victim.key);
      }

      return prev.filter((_, i) => i !== index);
    });
    clearItemFieldErrors();
  }

  function buildItemsPayload() {
    return lines.map((l) => ({
      start_date: l.start_date || null,
      end_date: l.end_date || null,
      rate_set_id: l.rate_set_id === "" ? null : l.rate_set_id,
      category_id: l.category_id === "" ? null : l.category_id,
      support_item_id: l.support_item_id === "" ? null : l.support_item_id,
      max_rate: l.max_rate || null,
      unit: l.unit || null,
      input_rate: l.input_rate || null,
    }));
  }

  async function submitInvoice(status: "drafted" | "completed") {
    if (drawerReadOnly) {
      return;
    }
    setDrawerError(null);
    setDrawerFieldErrors({});

    if (status === "completed") {
      const localErrors: FieldErrors<string> = {};

      lines.forEach((line, index) => {
        const lineDateError = getInvoiceLineDateRangeError(line);
        const lineInputRateError = getInvoiceLineInputRateError(line);

        if (lineDateError !== null) {
          localErrors[`items[${index}].end_date`] = lineDateError;
        }

        if (lineInputRateError !== null) {
          localErrors[`items[${index}].input_rate`] = lineInputRateError;
        }
      });

      if (Object.keys(localErrors).length > 0) {
        setDrawerFieldErrors(localErrors);
        return;
      }
    }

    setSaveSubmitting(true);

    try {
      if (status === "drafted") {
        const invoiceNumber = formInvoiceNumber.trim();

        if (formProviderId !== "" && invoiceNumber !== "") {
          const searchParams = new URLSearchParams();
          searchParams.set("invoice_number", invoiceNumber);
          searchParams.set("provider_id", formProviderId);

          if (editingInvoiceId !== null) {
            searchParams.set("exclude_id", String(editingInvoiceId));
          }

          const { exists } = await fetchInvoiceNumberExists(searchParams);

          if (exists) {
            setDrawerFieldErrors({
              invoice_number: "This invoice number is already used for this provider.",
            });
            setSaveSubmitting(false);
            return;
          }
        }
      }

      const endpoint =
        editingInvoiceId === null ? "/api/invoices" : `/api/invoices/${editingInvoiceId}`;
      const method = editingInvoiceId === null ? "POST" : "PATCH";

      await fetchApiData<InvoiceListRow>(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          client_id: Number.parseInt(formClientId, 10),
          provider_id: Number.parseInt(formProviderId, 10),
          invoice_number: formInvoiceNumber.trim(),
          invoice_date: formInvoiceDate,
          amount: derivedInvoiceTotal === "" ? null : derivedInvoiceTotal,
          expected_amount: formExpectedAmount,
          items: buildItemsPayload(),
        }),
      });

      let nextToastMessage = "Invoice saved as draft.";

      if (editingInvoiceId === null && status === "completed") {
        nextToastMessage = "Invoice saved successfully.";
      } else if (editingInvoiceId !== null && status === "completed") {
        nextToastMessage = "Invoice updated successfully.";
      } else if (editingInvoiceId !== null) {
        nextToastMessage = "Invoice draft updated successfully.";
      }

      setToastMessage(nextToastMessage);
      closeDrawer();
      await loadInvoices();
    } catch (error) {
      const rawFieldErrors =
        error instanceof ApiRequestError
          ? getRequestFieldErrors<string>(error)
          : {};

      const hadItemFieldErrors = Object.keys(rawFieldErrors).some((key) =>
        key.startsWith("items["),
      );
      const nonItemFieldErrors = Object.fromEntries(
        Object.entries(rawFieldErrors).filter(([key]) => !key.startsWith("items[")),
      ) as FieldErrors<string>;

      setDrawerFieldErrors(nonItemFieldErrors);

      const hasNonItemErrors = Object.keys(nonItemFieldErrors).length > 0;

      if (error instanceof ApiRequestError) {
        if (error.code === "VALIDATION_ERROR") {
          if (hadItemFieldErrors && hasNonItemErrors) {
            setDrawerError(
              "Please fix the highlighted fields and complete each line item (including service start and end dates).",
            );
          } else if (hadItemFieldErrors) {
            setDrawerError(
              "Please set service start and end dates for each line item before saving.",
            );
          } else if (hasNonItemErrors) {
            setDrawerError(null);
          } else {
            setDrawerError(
              getRequestErrorMessage(error, "Failed to save invoice."),
            );
          }
        } else {
          setDrawerError(getRequestErrorMessage(error, "Failed to save invoice."));
        }
      } else {
        setDrawerError(getRequestErrorMessage(error, "Failed to save invoice."));
      }
    } finally {
      setSaveSubmitting(false);
    }
  }

  async function handleImportPdf(file: File) {
    if (!canWriteInvoices || drawerReadOnly) {
      return;
    }

    setPdfImportLoading(true);
    setPdfImportWarnings(null);
    setDrawerError(null);

    try {
      const body = new FormData();

      body.set("file", file);

      const data = await fetchApiData<InvoicePdfExtractResponse>(
        "/api/invoices/extract-pdf",
        { method: "POST", body },
      );

      if (data.client_id !== null) {
        setFormClientId(String(data.client_id));
      }

      if (data.provider_id !== null) {
        setFormProviderId(String(data.provider_id));
      }

      if (data.invoice_number !== null && data.invoice_number !== "") {
        setFormInvoiceNumber(data.invoice_number);
      }

      if (data.invoice_date !== null && data.invoice_date !== "") {
        setFormInvoiceDate(data.invoice_date);
      }

      if (data.expected_amount !== null && data.expected_amount !== "") {
        setFormExpectedAmount(data.expected_amount);
      }

      setLines(
        data.lines.length > 0
          ? data.lines.map(mapExtractedLineToForm)
          : [newLine()],
      );
      setDrawerFieldErrors({});

      if (data.warnings.length > 0) {
        setPdfImportWarnings(data.warnings);
      }

      setToastMessage("Imported from PDF — review fields before saving.");
    } catch (error) {
      setDrawerError(getRequestErrorMessage(error, "PDF import failed."));
    } finally {
      setPdfImportLoading(false);
    }
  }

  async function handleDelete(row: InvoiceListRow) {
    if (!canDeleteInvoices) {
      return;
    }
    const ok = globalThis.confirm(
      `Delete invoice ${row.invoice_number}? This cannot be undone.`,
    );

    if (!ok) {
      return;
    }

    setDeletingId(row.id);
    setLoadError(null);

    try {
      await fetchApiData(`/api/invoices/${row.id}`, { method: "DELETE" });
      setToastMessage("Invoice removed successfully.");
      await loadInvoices();
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Failed to delete invoice."));
    } finally {
      setDeletingId(null);
    }
  }

  let drawerTitle = "Edit Invoice";
  if (editingInvoiceId === null) {
    drawerTitle = "Add Invoice";
  } else if (drawerReadOnly) {
    drawerTitle = "View Invoice";
  }
  const showSaveAsDraft =
    editingInvoiceId === null || editingInvoiceStatus === "drafted";
  const ro = drawerReadOnly;

  return (
    <div className="mx-auto w-full max-w-7xl">
      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed top-6 left-1/2 z-200 flex max-w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 justify-center px-4"
        >
          <div className="pointer-events-auto rounded-xl border border-white/25 bg-[rgb(18,185,129)] px-5 py-3 text-sm font-medium text-white shadow-lg">
            {toastMessage}
          </div>
        </div>
      ) : null}

      {drawerError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="pointer-events-none fixed top-6 left-1/2 z-200 flex max-w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 justify-center px-4"
        >
          <div className="pointer-events-auto rounded-xl border border-white/25 bg-rose-600 px-5 py-3 text-sm font-medium text-white shadow-lg">
            {drawerError}
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
            Invoices
          </h2>
          <p className="mt-2 text-sm text-slate-500">Manage invoices.</p>
          {!canWriteInvoices ? (
            <p className="mt-2 text-sm text-slate-500">
              You have read-only access; add, edit, and delete require the
              corresponding invoice permissions.
            </p>
          ) : null}
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadInvoices()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openAddDrawer}
              disabled={!canWriteInvoices}
              title={
                !canWriteInvoices
                  ? "You need invoices.write to add invoices."
                  : undefined
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Add Invoice
            </button>
          </div>

          {optionsError ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {optionsError}
            </div>
          ) : null}

          {loadError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {loadError}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:items-end">
            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="invoiceNumberSearch"
              >
                Invoice Number
              </label>
              <input
                id="invoiceNumberSearch"
                value={invoiceNumberInput}
                onChange={(e) => setInvoiceNumberInput(e.target.value)}
                placeholder="Search invoice number"
                className={INPUT_CLASS_NAME}
              />
            </div>

            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="invoiceClientFilter"
              >
                Participant
              </label>
              <select
                id="invoiceClientFilter"
                value={clientIdFilter}
                onChange={(e) => setClientIdFilter(e.target.value)}
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All participants</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="invoiceProviderFilter"
              >
                Provider
              </label>
              <select
                id="invoiceProviderFilter"
                value={providerIdFilter}
                onChange={(e) => setProviderIdFilter(e.target.value)}
                className={INPUT_CLASS_NAME}
              >
                <option value="all">All providers</option>
                {providerOptions.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="text-sm font-medium text-slate-500"
                htmlFor="invoiceDateFilter"
              >
                Invoice Date
              </label>
              <input
                id="invoiceDateFilter"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className={INPUT_CLASS_NAME}
              />
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">Participant</th>
                  <th className="px-3 py-3 font-semibold">Provider</th>
                  <th className="px-3 py-3 font-semibold">Invoice Number</th>
                  <th className="px-3 py-3 font-semibold">Invoice Date</th>
                  <th className="px-3 py-3 font-semibold">Expected Amount</th>
                  <th className="px-3 py-3 font-semibold">Amount</th>
                  <th className="px-3 py-3 text-center font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && invoices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-10 text-center text-sm text-slate-500"
                    >
                      No invoices found for the current filters.
                    </td>
                  </tr>
                ) : null}

                {invoices.map((row) => (
                  <tr key={row.id} className="transition hover:bg-slate-50">
                    <td className="px-3 py-4 text-slate-700">
                      {row.client_label}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {row.provider_label}
                    </td>
                    <td className="px-3 py-4 font-medium text-slate-900">
                      {row.invoice_number}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatInvoiceDateUtc(row.invoice_date)}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatAmountCell(row.expected_amount)}
                    </td>
                    <td className="px-3 py-4 text-slate-700">
                      {formatAmountCell(row.amount)}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => void openEditDrawer(row.id)}
                          disabled={loadingEditId !== null}
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          {loadingEditId === row.id
                            ? "Loading..."
                            : canWriteInvoices
                              ? "Edit"
                              : "View"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(row)}
                          disabled={!canDeleteInvoices || deletingId === row.id}
                          title={
                            !canDeleteInvoices
                              ? "You need invoices.delete to remove invoices."
                              : undefined
                          }
                          className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingId === row.id ? "Deleting..." : "Delete"}
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

      {drawerOpen ? (
        <div className="fixed inset-0 z-60 flex justify-end bg-slate-900/60">
          <div
            className="flex h-full w-full max-w-4xl flex-col border-l border-slate-200 bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-invoice-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
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
                  id="add-invoice-title"
                  className="text-xl font-semibold tracking-tight text-slate-900"
                >
                  {drawerTitle}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!ro && canWriteInvoices ? (
                  <>
                    <input
                      ref={pdfFileInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const nextFile = e.target.files?.[0];
                        e.target.value = "";

                        if (nextFile) {
                          void handleImportPdf(nextFile);
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={saveSubmitting || pdfImportLoading}
                      onClick={() => pdfFileInputRef.current?.click()}
                      aria-label="Import invoice fields from a PDF file"
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      {pdfImportLoading ? "Importing…" : "Import From PDF"}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={closeDrawer}
                  disabled={saveSubmitting || pdfImportLoading}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                {!ro && showSaveAsDraft ? (
                  <button
                    type="button"
                    disabled={saveSubmitting || pdfImportLoading}
                    onClick={() => void submitInvoice("drafted")}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    Save as Draft
                  </button>
                ) : null}
                {!ro ? (
                  <button
                    type="button"
                    disabled={saveSubmitting || pdfImportLoading}
                    onClick={() => void submitInvoice("completed")}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
                  >
                    Save
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-y-auto px-5 py-4">
              {pdfImportWarnings !== null && pdfImportWarnings.length > 0 ? (
                <div
                  role="status"
                  className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                >
                  <p className="font-medium text-amber-900">PDF import notes</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-900/90">
                    {pdfImportWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-sm font-semibold text-slate-800">
                Invoice level details
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-sm font-medium text-slate-600">
                  <span className="text-rose-600">*</span> Participant
                  <select
                    value={formClientId}
                    disabled={ro}
                    onChange={(e) => {
                      setFormClientId(e.target.value);
                      setDrawerFieldErrors((p) => ({ ...p, client_id: undefined }));
                    }}
                    className={INPUT_CLASS_NAME}
                  >
                    <option value="">Select participant</option>
                    {clientOptions.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  {drawerFieldErrors.client_id ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {drawerFieldErrors.client_id}
                    </p>
                  ) : null}
                </label>

                <label className="text-sm font-medium text-slate-600">
                  <span className="text-rose-600">*</span> Provider
                  <select
                    value={formProviderId}
                    disabled={ro}
                    onChange={(e) => {
                      setFormProviderId(e.target.value);
                      setDrawerFieldErrors((p) => ({
                        ...p,
                        provider_id: undefined,
                      }));
                    }}
                    className={INPUT_CLASS_NAME}
                  >
                    <option value="">Select provider</option>
                    {providerOptions.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {drawerFieldErrors.provider_id ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {drawerFieldErrors.provider_id}
                    </p>
                  ) : null}
                </label>

                <label className="text-sm font-medium text-slate-600">
                  <span className="text-rose-600">*</span> Invoice Number
                  <input
                    value={formInvoiceNumber}
                    disabled={ro}
                    onChange={(e) => {
                      setFormInvoiceNumber(e.target.value);
                      setDrawerFieldErrors((p) => ({
                        ...p,
                        invoice_number: undefined,
                      }));
                    }}
                    className={INPUT_CLASS_NAME}
                  />
                  {drawerFieldErrors.invoice_number ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {drawerFieldErrors.invoice_number}
                    </p>
                  ) : null}
                </label>

                <label className="text-sm font-medium text-slate-600">
                  <span className="text-rose-600">*</span> Invoice Date
                  <input
                    type="date"
                    value={formInvoiceDate}
                    disabled={ro}
                    onChange={(e) => {
                      setFormInvoiceDate(e.target.value);
                      setDrawerFieldErrors((p) => ({
                        ...p,
                        invoice_date: undefined,
                      }));
                    }}
                    className={INPUT_CLASS_NAME}
                  />
                  {drawerFieldErrors.invoice_date ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {drawerFieldErrors.invoice_date}
                    </p>
                  ) : null}
                </label>

                <label className="text-sm font-medium text-slate-600">
                  <span className="text-rose-600">*</span> Expected Amount
                  <input
                    value={formExpectedAmount}
                    disabled={ro}
                    onChange={(e) => {
                      setFormExpectedAmount(e.target.value);
                      setDrawerFieldErrors((p) => ({
                        ...p,
                        expected_amount: undefined,
                      }));
                    }}
                    inputMode="decimal"
                    className={INPUT_CLASS_NAME}
                  />
                  {drawerFieldErrors.expected_amount ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {drawerFieldErrors.expected_amount}
                    </p>
                  ) : null}
                </label>

                <label className="text-sm font-medium text-slate-600">
                  Amount
                  <input
                    readOnly
                    value={derivedInvoiceTotal}
                    className={READONLY_INPUT_CLASS_NAME}
                    placeholder="—"
                  />
                </label>
              </div>

              {formClientId !== "" && selectedPricingRegion === "" ? (
                <p className="mt-3 text-xs text-amber-700">
                  Selected participant has no pricing region; max rate lookup may
                  fail until pricing is set on the client.
                </p>
              ) : null}

              <div className="mt-8 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">Items</p>
                <button
                  type="button"
                  onClick={addLine}
                  disabled={ro}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  + Add Item
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {lines.map((line, index) => {
                  const lineDateRangeError = getInvoiceLineDateRangeError(line);
                  const lineInputRateError = getInvoiceLineInputRateError(line);

                  return (
                    <div
                      key={line.key}
                      className="relative rounded-xl border border-slate-200 bg-slate-50/50 p-4 pt-10"
                    >
                    <div className="absolute right-3 top-3 flex flex-wrap gap-1">
                      <button
                        type="button"
                        title="Duplicate row"
                        onClick={() => duplicateLine(index)}
                        disabled={ro}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        title="Remove row"
                        onClick={() => removeLine(index)}
                        disabled={ro}
                        className="rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="text-sm font-medium text-slate-600">
                        <span className="text-rose-600">*</span> Service Start
                        Date
                        <input
                          type="date"
                          value={line.start_date}
                          disabled={ro}
                          onChange={(e) => {
                            const v = e.target.value;
                            const nextEndDate =
                              line.end_date !== "" && v !== "" && line.end_date < v
                                ? ""
                                : line.end_date;
                            const nextLine: InvoiceLineForm = {
                              ...line,
                              start_date: v,
                              end_date: nextEndDate,
                            };
                            updateLine(index, {
                              start_date: v,
                              end_date: nextEndDate,
                            });
                            setDrawerFieldErrors((previous) => ({
                              ...previous,
                              [`items[${index}].start_date`]: undefined,
                              [`items[${index}].end_date`]: undefined,
                            }));
                            if (
                              !nextLine.start_date ||
                              !nextLine.end_date ||
                              nextLine.start_date > nextLine.end_date
                            ) {
                              cancelRateSetLookupForLineKey(nextLine.key);
                              void resolveRateSetForLineKey(nextLine.key, nextLine);
                            } else {
                              scheduleResolveRateSetForLineKey(
                                nextLine.key,
                                nextLine,
                              );
                            }
                          }}
                          className={INPUT_CLASS_NAME}
                        />
                      </label>
                      <label className="text-sm font-medium text-slate-600">
                        <span className="text-rose-600">*</span> Service End Date
                        <input
                          type="date"
                          value={line.end_date}
                          min={line.start_date || undefined}
                          disabled={ro}
                          onChange={(e) => {
                            const v = e.target.value;
                            const nextLine: InvoiceLineForm = {
                              ...line,
                              end_date: v,
                            };
                            updateLine(index, { end_date: v });
                            setDrawerFieldErrors((previous) => ({
                              ...previous,
                              [`items[${index}].end_date`]: undefined,
                            }));
                            if (
                              !nextLine.start_date ||
                              !nextLine.end_date ||
                              nextLine.start_date > nextLine.end_date
                            ) {
                              cancelRateSetLookupForLineKey(nextLine.key);
                              void resolveRateSetForLineKey(nextLine.key, nextLine);
                            } else {
                              scheduleResolveRateSetForLineKey(
                                nextLine.key,
                                nextLine,
                              );
                            }
                          }}
                          className={
                            lineDateRangeError === null
                              ? INPUT_CLASS_NAME
                              : `${INPUT_CLASS_NAME} border-rose-300 focus:border-rose-400`
                          }
                        />
                        {lineDateRangeError ? (
                          <p className="mt-1 text-xs text-rose-600">
                            {lineDateRangeError}
                          </p>
                        ) : null}
                      </label>
                      <div className="text-sm text-slate-500 sm:col-span-2 lg:col-span-1">
                        {line.loadingRateSet ? (
                          <p className="mt-8">Resolving rate set…</p>
                        ) : null}
                        {line.rateSetMessage ? (
                          <p className="mt-8 text-rose-600">{line.rateSetMessage}</p>
                        ) : null}
                        {line.rate_set_id !== "" && !line.rateSetMessage ? (
                          <p className="mt-8 text-xs text-slate-400">
                            Rate set #{line.rate_set_id}
                          </p>
                        ) : null}
                      </div>

                      <label className="text-sm font-medium text-slate-600">
                        <span className="text-rose-600">*</span> Support
                        Category
                        <select
                          value={line.category_id === "" ? "" : String(line.category_id)}
                          disabled={ro || line.rate_set_id === ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const idNum = v === "" ? "" : Number.parseInt(v, 10);
                            updateLine(index, {
                              category_id: idNum,
                              supportItems: [],
                              support_item_id: "",
                              max_rate: "",
                            });

                            if (idNum !== "") {
                              void loadSupportItemsForLine(index, idNum);
                            }
                          }}
                          className={INPUT_CLASS_NAME}
                        >
                          <option value="">Select category</option>
                          {line.categories.map((c) => (
                            <option key={c.id} value={String(c.id)}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-sm font-medium text-slate-600 sm:col-span-2">
                        <span className="text-rose-600">*</span> Support Item
                        <select
                          value={
                            line.support_item_id === ""
                              ? ""
                              : String(line.support_item_id)
                          }
                          disabled={ro || line.category_id === ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const parsed =
                              v === "" ? NaN : Number.parseInt(v, 10);
                            const supportItemId: number | "" =
                              v === "" || !Number.isInteger(parsed) || parsed < 1
                                ? ""
                                : parsed;
                            const next: InvoiceLineForm = {
                              ...line,
                              support_item_id: supportItemId,
                              max_rate: "",
                            };
                            updateLine(index, {
                              support_item_id: supportItemId,
                              max_rate: "",
                            });
                            void loadMaxRateForLine(index, next);
                          }}
                          className={INPUT_CLASS_NAME}
                        >
                          <option value="">Select support item</option>
                          {line.supportItems.map((s) => (
                            <option key={s.id} value={String(s.id)}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-sm font-medium text-slate-600">
                        Max Rate
                        <input
                          readOnly
                          value={
                            line.loadingMaxRate ? "…" : line.max_rate
                          }
                          className={READONLY_INPUT_CLASS_NAME}
                        />
                      </label>

                      <label className="text-sm font-medium text-slate-600">
                        <span className="text-rose-600">*</span> Unit
                        <input
                          value={line.unit}
                          disabled={ro}
                          onChange={(e) =>
                            updateLine(index, { unit: e.target.value })
                          }
                          inputMode="decimal"
                          className={INPUT_CLASS_NAME}
                        />
                      </label>

                      <label className="text-sm font-medium text-slate-600">
                        <span className="text-rose-600">*</span> Invoiced Rate
                        <input
                          value={line.input_rate}
                          disabled={ro}
                          onChange={(e) => {
                            updateLine(index, { input_rate: e.target.value });
                            setDrawerFieldErrors((previous) => ({
                              ...previous,
                              [`items[${index}].input_rate`]: undefined,
                            }));
                          }}
                          inputMode="decimal"
                          className={
                            lineInputRateError === null
                              ? INPUT_CLASS_NAME
                              : `${INPUT_CLASS_NAME} border-rose-300 focus:border-rose-400`
                          }
                        />
                        {lineInputRateError ? (
                          <p className="mt-1 text-xs text-rose-600">
                            {lineInputRateError}
                          </p>
                        ) : null}
                      </label>

                      <label className="text-sm font-medium text-slate-600">
                        Invoiced Amount
                        <input
                          readOnly
                          value={lineInvoicedAmount(line)}
                          className={READONLY_INPUT_CLASS_NAME}
                        />
                      </label>
                    </div>
                    </div>
                  );
                })}
              </div>

              {drawerFieldErrors.items ? (
                <p className="mt-4 text-sm text-rose-600">
                  {drawerFieldErrors.items}
                </p>
              ) : null}
              {drawerFieldErrors.form ? (
                <p className="mt-2 text-sm text-rose-600">
                  {drawerFieldErrors.form}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
