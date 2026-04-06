# Database migrations

## How schema is applied in this project

There are **two complementary** ways DDL is expressed:

1. **Runtime (primary)** — On first use, repositories call **`ensure*Schema()`** / **`ensureRbacRoleSchemaPatches()`** in `src/repositories/*.ts`. These run idempotent `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, and indexes. This bootstraps a fresh database when you run `npm run dev` and hit APIs that touch each domain.

2. **SQL files (this folder + `src/db/`)** — For **review, assignments, and DBA workflows**, static SQL is provided or referenced here. Files use `IF NOT EXISTS` where possible so they are safe to re-run.

## Files

| File / path | Purpose |
|-------------|---------|
| `001_gender_and_client.sql` | **`gender`** and **`client`** (participants) tables — not created by any `ensure*Schema` in TypeScript today; run if you need these tables before using participant APIs. |
| `../src/db/ndis_excel_import_logic.sql` | Reference DDL related to **rate set** import structures (overlaps with `ensureRateSetInvoiceSchema` in code; useful for offline review). |

## Applying SQL manually

```bash
# Example: after Docker Postgres is up (`npm run db:up`)
psql "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" -f db/migrations/001_gender_and_client.sql
```

Use values from your `.env` (see root `.env.example`).

## Environment flags

- **`RBAC_SKIP_DDL=1`** — Skips repository-driven DDL (for locked-down environments where only migration tools may alter schema).

## Generating a full schema dump (optional)

After the app has started once and touched all domains:

```bash
pg_dump --schema-only --no-owner "postgresql://..." > db/migrations/_schema_snapshot.sql
```

Review before committing; snapshots are environment-specific.
