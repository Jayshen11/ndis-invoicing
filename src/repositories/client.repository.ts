import { sql } from "kysely";
import { db } from "@/db/client";
import type { ClientRow, CreateClientInput } from "@/modules/client/types";

function getInsertDeactivatedAtValue(active: boolean) {
  return active ? sql`null` : sql`now()`;
}

function getUpdateDeactivatedAtValue(active: boolean) {
  return active ? sql`null` : sql`coalesce(deactivated_at, now())`;
}

export async function listClientRows(): Promise<ClientRow[]> {
  const result = await sql<ClientRow>`
    select
      c.id::text as id,
      c.first_name,
      c.last_name,
      c.gender_id,
      nullif(trim(coalesce(g.label, '')), '') as gender_label,
      c.dob::text as dob,
      c.ndis_number,
      c.email,
      c.phone_number,
      c.address,
      c.unit_building,
      c.pricing_region,
      c.created_at::text as created_at,
      c.updated_at::text as updated_at,
      c.deactivated_at::text as deactivated_at,
      c.deleted_at::text as deleted_at
    from client c
    left join gender g on g.id = c.gender_id
    where c.deleted_at is null
    order by c.last_name asc, c.first_name asc, c.id asc
  `.execute(db);

  return result.rows;
}

export async function insertClientRow(
  input: CreateClientInput,
): Promise<ClientRow> {
  const deactivatedAtValue = getInsertDeactivatedAtValue(input.active);

  const result = await sql<ClientRow>`
    insert into client (
      first_name,
      last_name,
      gender_id,
      dob,
      ndis_number,
      email,
      phone_number,
      address,
      unit_building,
      pricing_region,
      deactivated_at
    )
    values (
      ${input.firstName},
      ${input.lastName},
      ${input.genderId},
      ${input.dob},
      ${input.ndisNumber},
      ${input.email},
      ${input.phoneNumber},
      ${input.address},
      ${input.unitBuilding},
      ${input.pricingRegion},
      ${deactivatedAtValue}
    )
    returning
      id::text as id,
      first_name,
      last_name,
      gender_id,
      dob::text as dob,
      ndis_number,
      email,
      phone_number,
      address,
      unit_building,
      pricing_region,
      created_at::text as created_at,
      updated_at::text as updated_at,
      deactivated_at::text as deactivated_at,
      deleted_at::text as deleted_at
  `.execute(db);

  const createdClient = result.rows[0];

  if (!createdClient) {
    throw new Error("Client insert returned no rows.");
  }

  return createdClient;
}

export async function getClientRowById(
  clientId: number,
): Promise<ClientRow | undefined> {
  const result = await sql<ClientRow>`
    select
      c.id::text as id,
      c.first_name,
      c.last_name,
      c.gender_id,
      nullif(trim(coalesce(g.label, '')), '') as gender_label,
      c.dob::text as dob,
      c.ndis_number,
      c.email,
      c.phone_number,
      c.address,
      c.unit_building,
      c.pricing_region,
      c.created_at::text as created_at,
      c.updated_at::text as updated_at,
      c.deactivated_at::text as deactivated_at,
      c.deleted_at::text as deleted_at
    from client c
    left join gender g
      on g.id = c.gender_id
      and g.deactivated_at is null
    where c.id = ${clientId}
      and c.deleted_at is null
    limit 1
  `.execute(db);

  return result.rows[0];
}

export async function updateClientRow(
  clientId: number,
  input: CreateClientInput,
): Promise<ClientRow | undefined> {
  const deactivatedAtValue = getUpdateDeactivatedAtValue(input.active);

  const result = await sql<ClientRow>`
    update client
    set
      first_name = ${input.firstName},
      last_name = ${input.lastName},
      gender_id = ${input.genderId},
      dob = ${input.dob},
      ndis_number = ${input.ndisNumber},
      email = ${input.email},
      phone_number = ${input.phoneNumber},
      address = ${input.address},
      unit_building = ${input.unitBuilding},
      pricing_region = ${input.pricingRegion},
      deactivated_at = ${deactivatedAtValue},
      updated_at = now()
    where id = ${clientId}
      and deleted_at is null
    returning
      id::text as id,
      first_name,
      last_name,
      gender_id,
      dob::text as dob,
      ndis_number,
      email,
      phone_number,
      address,
      unit_building,
      pricing_region,
      created_at::text as created_at,
      updated_at::text as updated_at,
      deactivated_at::text as deactivated_at,
      deleted_at::text as deleted_at
  `.execute(db);

  return result.rows[0];
}

export type ClientOptionRow = {
  id: number;
  label: string;
  pricing_region: string;
};

/** SEC: Options for filters; label + pricing region for invoice pricing lookups. */
export async function listClientOptionRows(): Promise<ClientOptionRow[]> {
  const result = await sql<ClientOptionRow>`
    SELECT
      c.id,
      trim(c.first_name) || ' ' || trim(c.last_name) || ' (' || c.ndis_number || ')' AS label,
      c.pricing_region
    FROM client c
    WHERE c.deleted_at IS NULL
    ORDER BY lower(c.last_name) ASC, lower(c.first_name) ASC, c.id ASC
  `.execute(db);

  return result.rows;
}

/** Match participant by NDIS number digits (handles spaces/dashes in stored values). */
export async function findActiveClientIdByNdisDigits(
  ndisDigits: string,
): Promise<number | null> {
  if (ndisDigits === "") {
    return null;
  }

  const result = await sql<{ id: number }>`
    SELECT c.id
    FROM client c
    WHERE c.deleted_at IS NULL
      AND c.deactivated_at IS NULL
      AND regexp_replace(coalesce(c.ndis_number, ''), '[^0-9]', '', 'g') = ${ndisDigits}
    ORDER BY c.id ASC
    LIMIT 3
  `.execute(db);

  if (result.rows.length !== 1) {
    return null;
  }

  return result.rows[0]!.id;
}

export async function getClientPricingRegionByClientId(
  clientId: number,
): Promise<string | null> {
  const result = await sql<{ pricing_region: string | null }>`
    SELECT c.pricing_region
    FROM client c
    WHERE c.id = ${clientId}
      AND c.deleted_at IS NULL
    LIMIT 1
  `.execute(db);

  const raw = result.rows[0]?.pricing_region?.trim();

  return raw && raw !== "" ? raw : null;
}

export async function softDeleteClientRow(
  clientId: number,
): Promise<{ id: string; deleted_at: string } | undefined> {
  const result = await sql<{ id: string; deleted_at: string }>`
    update client
    set
      deleted_at = now(),
      updated_at = now()
    where id = ${clientId}
      and deleted_at is null
    returning
      id::text as id,
      deleted_at::text as deleted_at
  `.execute(db);

  return result.rows[0];
}

export async function activeGenderExists(genderId: number): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    select exists(
      select 1
      from gender
      where id = ${genderId}
        and deactivated_at is null
    ) as exists
  `.execute(db);

  return result.rows[0]?.exists ?? false;
}

export async function activePricingRegionExists(
  pricingRegion: string,
): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    select exists(
      select 1
      from rate_set_support_item_pricing_region
      where code = ${pricingRegion}
        and deactivated_at is null
    ) as exists
  `.execute(db);

  return result.rows[0]?.exists ?? false;
}
