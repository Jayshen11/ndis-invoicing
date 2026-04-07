# Database migrations

## How schema is applied in this project

There are **two complementary** ways DDL is expressed:

1. **Runtime (primary for iterative dev)** — On first use, repositories call **`ensure*Schema()`** / **`ensureRbacRoleSchemaPatches()`** in `src/repositories/*.ts`. These run idempotent `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, and indexes. This bootstraps a fresh database when you run `npm run dev` and hit APIs that touch each domain.

2. **SQL files (this folder + `src/db/`)** — For **review, assignments, Neon/Vercel greenfield DBs, and DBA workflows**, static SQL is provided. Files use `IF NOT EXISTS` / idempotent seeds where possible.

## Files

| File / path | Purpose |
|-------------|---------|
| `001_full_schema.sql` | **Baseline** for an **empty** database: rate sets (with `btree_gist` overlap rule), pricing regions, gender + client, provider, invoice, RBAC seeds (permission ids **1–26** per `permissions-catalog.ts`), `app_user`, `auth_password`, `auth_session`, `audit_log`. |
| `../src/db/ndis_excel_import_logic.sql` | Reference DDL for **rate set** import (overlaps `ensureRateSetInvoiceSchema`; useful for offline review). |

## Applying SQL manually

**Greenfield (recommended for Neon):** run the full baseline once:

```bash
psql "$DATABASE_URL" -f db/migrations/001_full_schema.sql
```

**Docker (individual `DB_*` vars):**

```bash
psql "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" -f db/migrations/001_full_schema.sql
```

Use values from your `.env` (see root `.env.example`).

If the database **already** has objects created by the running app, `CREATE TABLE IF NOT EXISTS` will skip existing tables; prefer a **new empty database** for a clean baseline.

## Environment flags

- **`RBAC_SKIP_DDL=1`** — Skips repository-driven DDL (for locked-down environments where only migration tools may alter schema).

## Generating a full schema dump (optional)

After the app has started once and touched all domains:

```bash
pg_dump --schema-only --no-owner "postgresql://..." > db/migrations/_schema_snapshot.sql
```

Review before committing; snapshots are environment-specific.
