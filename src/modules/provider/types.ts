/** API / DB row shape (snake_case), matches `GET /api/providers` items. */
export type ProviderApiRecord = {
  id: number;
  abn: string;
  name: string;
  email: string;
  phone_number: string | null;
  address: string | null;
  unit_building: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deleted_at: string | null;
};

export type ProviderListFilters = {
  search: string;
  status: "active" | "inactive" | "all";
  limit: number;
  offset: number;
};

export type CreateProviderInput = {
  abn: string;
  name: string;
  email: string;
  phone_number: string | null;
  address: string | null;
  unit_building: string | null;
  active: boolean;
};

export type UpdateProviderInput = Partial<CreateProviderInput>;
