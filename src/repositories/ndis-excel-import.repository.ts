import type { Kysely } from "kysely";
import { sql } from "kysely";
import type {
  NdisExcelHeaderMeta,
  NdisExcelLogicalRow,
} from "@/lib/ndis-excel/parse-ndis-excel";

/** Matches untyped `Database` in `src/db/client.ts` for raw SQL execution. */
export type RateSetDbExecutor = Kysely<Record<string, Record<string, unknown>>>;

function utcMidnightIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");

  return `${y}-${m}-${day}T00:00:00.000Z`;
}

function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function latestRowForItem(
  rows: NdisExcelLogicalRow[],
  itemNumber: string,
): NdisExcelLogicalRow | undefined {
  let best: NdisExcelLogicalRow | undefined;

  for (const r of rows) {
    if (r.itemNumber !== itemNumber) {
      continue;
    }

    if (!best || r.sourceRowIndex >= best.sourceRowIndex) {
      best = r;
    }
  }

  return best;
}

function latestRowForCategory(
  rows: NdisExcelLogicalRow[],
  categoryNumber: string,
): NdisExcelLogicalRow | undefined {
  let best: NdisExcelLogicalRow | undefined;

  for (const r of rows) {
    if (r.categoryNumber !== categoryNumber) {
      continue;
    }

    if (!best || r.sourceRowIndex >= best.sourceRowIndex) {
      best = r;
    }
  }

  return best;
}

async function upsertCategory(
  trx: RateSetDbExecutor,
  rateSetId: number,
  categoryNumber: string,
  categoryName: string,
  sorting: number,
): Promise<number> {
  const active = await sql<{ id: number }>`
    SELECT id
    FROM rate_set_category
    WHERE rate_set_id = ${rateSetId}
      AND category_number = ${categoryNumber}
      AND deleted_at IS NULL
    LIMIT 1
  `.execute(trx);

  const activeId = active.rows[0]?.id;

  if (activeId !== undefined) {
    await sql`
      UPDATE rate_set_category
      SET
        category_name = ${categoryName},
        sorting = ${sorting},
        updated_at = now()
      WHERE id = ${activeId}
    `.execute(trx);

    return activeId;
  }

  const tomb = await sql<{ id: number }>`
    SELECT id
    FROM rate_set_category
    WHERE rate_set_id = ${rateSetId}
      AND category_number = ${categoryNumber}
      AND deleted_at IS NOT NULL
    ORDER BY id DESC
    LIMIT 1
  `.execute(trx);

  const tombId = tomb.rows[0]?.id;

  if (tombId !== undefined) {
    await sql`
      UPDATE rate_set_category
      SET
        category_name = ${categoryName},
        sorting = ${sorting},
        deleted_at = NULL,
        deactivated_at = NULL,
        updated_at = now()
      WHERE id = ${tombId}
    `.execute(trx);

    return tombId;
  }

  const ins = await sql<{ id: number }>`
    INSERT INTO rate_set_category (
      rate_set_id,
      category_number,
      category_name,
      sorting
    )
    VALUES (${rateSetId}, ${categoryNumber}, ${categoryName}, ${sorting})
    RETURNING id
  `.execute(trx);

  const id = ins.rows[0]?.id;

  if (id === undefined) {
    throw new Error("Failed to insert rate_set_category.");
  }

  return id;
}

async function upsertSupportItem(
  trx: RateSetDbExecutor,
  rateSetId: number,
  categoryId: number,
  itemNumber: string,
  itemName: string,
  unit: string | null,
  sorting: number,
): Promise<number> {
  const active = await sql<{ id: number }>`
    SELECT id
    FROM rate_set_support_item
    WHERE rate_set_id = ${rateSetId}
      AND item_number = ${itemNumber}
      AND deleted_at IS NULL
    LIMIT 1
  `.execute(trx);

  const activeId = active.rows[0]?.id;

  if (activeId !== undefined) {
    await sql`
      UPDATE rate_set_support_item
      SET
        category_id = ${categoryId},
        item_name = ${itemName},
        unit = ${unit},
        sorting = ${sorting},
        updated_at = now()
      WHERE id = ${activeId}
    `.execute(trx);

    return activeId;
  }

  const tomb = await sql<{ id: number }>`
    SELECT id
    FROM rate_set_support_item
    WHERE rate_set_id = ${rateSetId}
      AND item_number = ${itemNumber}
      AND deleted_at IS NOT NULL
    ORDER BY id DESC
    LIMIT 1
  `.execute(trx);

  const tombId = tomb.rows[0]?.id;

  if (tombId !== undefined) {
    await sql`
      UPDATE rate_set_support_item
      SET
        category_id = ${categoryId},
        item_name = ${itemName},
        unit = ${unit},
        sorting = ${sorting},
        deleted_at = NULL,
        deactivated_at = NULL,
        updated_at = now()
      WHERE id = ${tombId}
    `.execute(trx);

    return tombId;
  }

  const ins = await sql<{ id: number }>`
    INSERT INTO rate_set_support_item (
      rate_set_id,
      category_id,
      item_number,
      item_name,
      unit,
      sorting
    )
    VALUES (
      ${rateSetId},
      ${categoryId},
      ${itemNumber},
      ${itemName},
      ${unit},
      ${sorting}
    )
    RETURNING id
  `.execute(trx);

  const id = ins.rows[0]?.id;

  if (id === undefined) {
    throw new Error("Failed to insert rate_set_support_item.");
  }

  return id;
}

async function upsertAttribute(
  trx: RateSetDbExecutor,
  supportItemId: number,
  attributeCode: string,
  value: boolean,
): Promise<void> {
  await sql`
    INSERT INTO rate_set_support_item_attribute (
      support_item_id,
      attribute_code,
      value
    )
    VALUES (${supportItemId}, ${attributeCode}, ${value})
    ON CONFLICT (support_item_id, attribute_code) DO UPDATE
    SET value = EXCLUDED.value
  `.execute(trx);
}

/** Keeps INSERT round-trips low while staying under Postgres param limits (~65k). */
const NDIS_PRICE_INSERT_BATCH_SIZE = 1000;

type NdisPriceInsertRow = {
  supportItemId: number;
  typeId: number | null;
  regionCode: string;
  startTs: string;
  endTs: string | null;
  unitPrice: number;
};

function sqlPriceEndDate(endTs: string | null) {
  if (endTs === null) {
    return sql`NULL`;
  }

  return sql`${endTs}::timestamptz`;
}

async function insertNdisPriceBatch(
  executor: RateSetDbExecutor,
  rateSetId: number,
  batch: NdisPriceInsertRow[],
): Promise<void> {
  if (batch.length === 0) {
    return;
  }

  await sql`
    INSERT INTO rate_set_support_item_price (
      rate_set_id,
      support_item_id,
      type_id,
      pricing_region_code,
      start_date,
      end_date,
      unit_price
    )
    VALUES ${sql.join(
      batch.map((r) =>
        sql`(
          ${rateSetId},
          ${r.supportItemId},
          ${r.typeId},
          ${r.regionCode},
          ${r.startTs}::timestamptz,
          ${sqlPriceEndDate(r.endTs)},
          ${r.unitPrice}
        )`,
      ),
      sql`, `,
    )}
  `.execute(executor);
}

async function resolveTypeId(
  trx: RateSetDbExecutor,
  code: string,
  label: string,
): Promise<number> {
  await sql`
    INSERT INTO rate_set_support_item_type (code, label)
    VALUES (${code}, ${label})
    ON CONFLICT (code) DO UPDATE
    SET
      label = EXCLUDED.label,
      deactivated_at = NULL
  `.execute(trx);

  const row = await sql<{ id: number }>`
    SELECT id FROM rate_set_support_item_type WHERE code = ${code} LIMIT 1
  `.execute(trx);

  const id = row.rows[0]?.id;

  if (id === undefined) {
    throw new Error("Failed to resolve support item type.");
  }

  return id;
}

export type NdisExcelImportStats = {
  categoriesTouched: number;
  itemsTouched: number;
  priceRowsWritten: number;
  categoriesSoftDeleted: number;
  itemsSoftDeleted: number;
};

/**
 * SEC: Caller must run inside a transaction and enforce AuthZ; `executor` is db or trx.
 */
export async function applyNdisExcelImport(
  executor: RateSetDbExecutor,
  rateSetId: number,
  header: NdisExcelHeaderMeta,
  rows: NdisExcelLogicalRow[],
): Promise<NdisExcelImportStats> {
  const rs = await sql<{ id: number }>`
    SELECT id
    FROM rate_set
    WHERE id = ${rateSetId} AND deleted_at IS NULL
    LIMIT 1
  `.execute(executor);

  if (!rs.rows[0]) {
    throw new Error("RATE_SET_NOT_FOUND");
  }

  for (const [code, label] of Object.entries(header.attributeLabels)) {
    if (label && label.trim() !== "") {
      await sql`
        UPDATE rate_set_support_item_attribute_type
        SET label = ${label.trim()}
        WHERE code = ${code}
      `.execute(executor);
    }
  }

  const uniqueCategoryNumbers = [
    ...new Set(rows.map((r) => r.categoryNumber)),
  ].sort(compareNatural);

  const categorySort = new Map<string, number>();

  for (let i = 0; i < uniqueCategoryNumbers.length; i++) {
    categorySort.set(uniqueCategoryNumbers[i]!, i + 1);
  }

  const categoryIdByNumber = new Map<string, number>();

  for (const catNum of uniqueCategoryNumbers) {
    const sample = latestRowForCategory(rows, catNum);

    if (!sample) {
      continue;
    }

    const sorting = categorySort.get(catNum) ?? 0;
    const id = await upsertCategory(
      executor,
      rateSetId,
      catNum,
      sample.categoryName,
      sorting,
    );

    categoryIdByNumber.set(catNum, id);
  }

  const uniqueItemNumbers = [...new Set(rows.map((r) => r.itemNumber))].sort(
    compareNatural,
  );
  const itemSort = new Map<string, number>();

  for (let i = 0; i < uniqueItemNumbers.length; i++) {
    itemSort.set(uniqueItemNumbers[i]!, i + 1);
  }

  const itemIdByNumber = new Map<string, number>();

  for (const itemNum of uniqueItemNumbers) {
    const sample = latestRowForItem(rows, itemNum);

    if (!sample) {
      continue;
    }

    const categoryId = categoryIdByNumber.get(sample.categoryNumber);

    if (categoryId === undefined) {
      throw new Error("Category mapping missing for item.");
    }

    const sorting = itemSort.get(itemNum) ?? 0;
    const id = await upsertSupportItem(
      executor,
      rateSetId,
      categoryId,
      itemNum,
      sample.itemName,
      sample.unit,
      sorting,
    );

    itemIdByNumber.set(itemNum, id);

    await upsertAttribute(executor, id, "IS_QUOTE_REQUIRED", sample.attrQuote);
    await upsertAttribute(
      executor,
      id,
      "IS_NF2F_SUPPORT_PROVISION",
      sample.attrNf2f,
    );
    await upsertAttribute(executor, id, "IS_PROVIDER_TRAVEL", sample.attrTravel);
    await upsertAttribute(
      executor,
      id,
      "IS_SHORT_NOTICE_CANCEL",
      sample.attrShortNotice,
    );
    await upsertAttribute(
      executor,
      id,
      "IS_NDIA_REQUESTED_REPORTS",
      sample.attrNdiaReports,
    );
    await upsertAttribute(
      executor,
      id,
      "IS_IRREGULAR_SIL_SUPPORTS",
      sample.attrIrregularSil,
    );
  }

  await sql`
    DELETE FROM rate_set_support_item_price
    WHERE rate_set_id = ${rateSetId}
  `.execute(executor);

  let priceRowsWritten = 0;
  const typeIdCache = new Map<string, number>();
  const priceBatch: NdisPriceInsertRow[] = [];

  async function flushPriceBatch(): Promise<void> {
    if (priceBatch.length === 0) {
      return;
    }

    await insertNdisPriceBatch(executor, rateSetId, priceBatch);
    priceRowsWritten += priceBatch.length;
    priceBatch.length = 0;
  }

  for (const logical of rows) {
    const supportItemId = itemIdByNumber.get(logical.itemNumber);

    if (supportItemId === undefined) {
      continue;
    }

    let typeId: number | null = null;

    if (logical.typeCode !== null) {
      const cached = typeIdCache.get(logical.typeCode);

      if (cached !== undefined) {
        typeId = cached;
      } else {
        typeId = await resolveTypeId(
          executor,
          logical.typeCode,
          logical.typeLabelRaw?.trim() || logical.typeCode,
        );
        typeIdCache.set(logical.typeCode, typeId);
      }
    }

    const startTs = utcMidnightIso(logical.priceStart);
    const endTs =
      logical.priceEnd === null ? null : utcMidnightIso(logical.priceEnd);

    for (const [regionCode, unitPrice] of logical.regionPrices) {
      priceBatch.push({
        supportItemId,
        typeId,
        regionCode,
        startTs,
        endTs,
        unitPrice,
      });

      if (priceBatch.length >= NDIS_PRICE_INSERT_BATCH_SIZE) {
        await flushPriceBatch();
      }
    }
  }

  await flushPriceBatch();

  let categoriesSoftDeleted = 0;

  if (uniqueCategoryNumbers.length > 0) {
    const delCat = await sql<{ one: number }>`
      WITH kept (category_number) AS (
        VALUES ${sql.join(
          uniqueCategoryNumbers.map((n) => sql`(${n})`),
          sql`, `,
        )}
      )
      UPDATE rate_set_category c
      SET deleted_at = now(), updated_at = now()
      WHERE c.rate_set_id = ${rateSetId}
        AND c.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM kept k WHERE k.category_number = c.category_number
        )
      RETURNING 1 AS one
    `.execute(executor);

    categoriesSoftDeleted = delCat.rows.length;
  }

  let itemsSoftDeleted = 0;

  if (uniqueItemNumbers.length > 0) {
    const delIt = await sql<{ one: number }>`
      WITH kept (item_number) AS (
        VALUES ${sql.join(
          uniqueItemNumbers.map((n) => sql`(${n})`),
          sql`, `,
        )}
      )
      UPDATE rate_set_support_item s
      SET deleted_at = now(), updated_at = now()
      WHERE s.rate_set_id = ${rateSetId}
        AND s.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM kept k WHERE k.item_number = s.item_number
        )
      RETURNING 1 AS one
    `.execute(executor);

    itemsSoftDeleted = delIt.rows.length;
  }

  return {
    categoriesTouched: uniqueCategoryNumbers.length,
    itemsTouched: uniqueItemNumbers.length,
    priceRowsWritten,
    categoriesSoftDeleted,
    itemsSoftDeleted,
  };
}
