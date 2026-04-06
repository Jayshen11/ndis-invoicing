/** Row from paginated invoice list (matches GET /api/invoices items). */
export type InvoiceListRow = {
  id: number;
  client_id: number;
  provider_id: number;
  status: string;
  invoice_number: string;
  invoice_date: string;
  amount: string | null;
  expected_amount: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  client_label: string;
  provider_label: string;
};

export type InvoiceItemRow = {
  id: number;
  invoice_id: number;
  rate_set_id: number | null;
  category_id: number | null;
  support_item_id: number | null;
  start_date: string | null;
  end_date: string | null;
  max_rate: string | null;
  unit: string | null;
  input_rate: string | null;
  amount: string | null;
  sort_order: number;
};

export type InvoiceDetailResponse = {
  invoice: InvoiceListRow;
  items: InvoiceItemRow[];
};

export type InvoiceListFilters = {
  invoiceNumberSearch: string;
  clientId: number | null;
  providerId: number | null;
  /** Calendar date in UTC `YYYY-MM-DD`, or null for any date. */
  invoiceDate: string | null;
  limit: number;
  offset: number;
};

export type SelectOptionRow = {
  id: number;
  label: string;
  /** Present on client (participant) options for pricing lookups. */
  pricing_region?: string;
};
