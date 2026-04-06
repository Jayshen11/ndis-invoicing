export type ClientRow = {
  id: string;
  first_name: string;
  last_name: string;
  gender_id: number;
  /** Present when loaded via join (list/detail); omitted on insert/update returning rows. */
  gender_label?: string | null;
  dob: string;
  ndis_number: string;
  email: string;
  phone_number: string | null;
  address: string;
  unit_building: string | null;
  pricing_region: string;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deleted_at: string | null;
};

export type Client = {
  id: string;
  firstName: string;
  lastName: string;
  genderId: number;
  /** Display label from gender join when available (no `genders.read` needed to show). */
  genderLabel: string | null;
  dob: string;
  ndisNumber: string;
  email: string;
  phoneNumber: string | null;
  address: string;
  unitBuilding: string | null;
  pricingRegion: string;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  deletedAt: string | null;
};

export type CreateClientInput = {
  firstName: string;
  lastName: string;
  genderId: number;
  dob: string;
  ndisNumber: string;
  email: string;
  phoneNumber: string | null;
  address: string;
  unitBuilding: string | null;
  pricingRegion: string;
  active: boolean;
};

export type UpdateClientInput = Partial<CreateClientInput>;

export function mapClientRow(row: ClientRow): Client {
  const rawLabel = row.gender_label;
  const genderLabel =
    typeof rawLabel === "string" && rawLabel.trim() !== ""
      ? rawLabel.trim()
      : null;

  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    genderId: row.gender_id,
    genderLabel,
    dob: row.dob,
    ndisNumber: row.ndis_number,
    email: row.email,
    phoneNumber: row.phone_number,
    address: row.address,
    unitBuilding: row.unit_building,
    pricingRegion: row.pricing_region,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapClientRowToCreateClientInput(
  row: ClientRow,
): CreateClientInput {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    genderId: row.gender_id,
    dob: row.dob,
    ndisNumber: row.ndis_number,
    email: row.email,
    phoneNumber: row.phone_number,
    address: row.address,
    unitBuilding: row.unit_building,
    pricingRegion: row.pricing_region,
    active: row.deactivated_at === null,
  };
}

function toUtcMidnightIso(dateOnly: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)
    ? `${dateOnly}T00:00:00.000Z`
    : dateOnly;
}

export function mapClientToApiRecord(client: Client): ClientRow {
  return {
    id: client.id,
    first_name: client.firstName,
    last_name: client.lastName,
    gender_id: client.genderId,
    gender_label: client.genderLabel,
    dob: toUtcMidnightIso(client.dob),
    ndis_number: client.ndisNumber,
    email: client.email,
    phone_number: client.phoneNumber,
    address: client.address,
    unit_building: client.unitBuilding,
    pricing_region: client.pricingRegion,
    created_at: client.createdAt,
    updated_at: client.updatedAt,
    deactivated_at: client.deactivatedAt,
    deleted_at: client.deletedAt,
  };
}
