# NDIS Invoicing

Next.js (App Router) admin application for NDIS-related invoicing workflows: participants (clients), providers, invoices, rate sets, RBAC, auth sessions, and audit logging.

---

## Deliverables (assignment checklist)

| Item | Location |
|------|----------|
| **Git repository** | This repo — submit remote URL or archive as required. |
| **Database migration scripts** | [`db/migrations/`](./db/migrations/) (SQL + README); runtime DDL also lives in [`src/repositories/*.ts`](./src/repositories/) (`ensure*Schema` functions). |
| **README** (this file) | Setup, assumptions, tradeoffs, incomplete. |
| **Architecture diagram** | [`docs/architecture.md`](./docs/architecture.md) (Mermaid — export to PNG/PDF via [mermaid.live](https://mermaid.live) or your diagram tool). |

---

## Setup instructions

### Prerequisites

- Node.js compatible with Next.js 16 (see `package.json`)
- Docker (for local PostgreSQL) **or** a reachable PostgreSQL instance

### 1. Environment

```bash
cp .env.example .env
```

Edit `.env`:

- Set a strong **`DB_PASSWORD`**
- Adjust **`DB_*`** if not using Docker defaults
- Optionally set **`DATABASE_URL`** for a managed Postgres instance

### 2. Database

```bash
npm run db:up
```

This starts PostgreSQL via `docker-compose.yml` (persistent volume).

### 3. Optional: SQL migrations folder

Participant (`client`) and **`gender`** tables are provided as explicit SQL (they are **not** created by TypeScript `ensure*Schema` today):

```bash
psql "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" -f db/migrations/001_gender_and_client.sql
```

Other domains (users, RBAC patches, providers, invoices, rate sets, sessions, audit log) are created or patched when the app runs and hits the corresponding APIs — see [`db/migrations/README.md`](./db/migrations/README.md).

### 4. Run the app

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use the dashboard database status as a quick connectivity check.

### Helpful commands

```bash
npm run db:up
npm run db:logs
npm run db:down
npm run build
npm run start
npm run lint
```

---

## Assumptions made

- **PostgreSQL** is the system of record; the app uses a connection pool (`src/db/client.ts`) and Kysely/raw SQL in repositories.
- **Authentication** uses an **`auth_session`** row plus **HttpOnly cookie**; permissions are enforced on API routes (`requirePermission`).
- **RBAC** may expect existing **`rbac_role`** / **`user_role`** tables in some deployments; the app applies **patches** and seeds permissions via `user-role.repository.ts` unless `RBAC_SKIP_DDL=1`.
- **Local dev** often shows loopback IPs (`127.0.0.1`, `::1`) for sessions; production should sit behind a proxy that sets **`X-Forwarded-For`** / **`X-Real-IP`** correctly.
- **Rate-set NDIS Excel** is uploaded to the API and parsed **in-process** (see `ndis-excel-import`); **AWS S3** and a standalone **AI extraction** service are treated as **architectural extensions** in [`docs/architecture.md`](./docs/architecture.md), not fully wired in every path.

---

## Tradeoffs

| Choice | Benefit | Cost |
|--------|---------|------|
| **Runtime `ensure*Schema` in TypeScript** | Fast local onboarding; idempotent patches; schema stays next to repositories. | Not a classic versioned migration chain; harder for DBAs who expect only Flyway/Liquibase-style files. |
| **`{ data }` / `{ error }` JSON envelopes** | Consistent client parsing (`src/lib/client/api.ts`). | A few utility endpoints return minimal shapes (e.g. `{ exists }`) for convenience. |
| **Next.js route handlers as API** | Single deployable unit; shared types. | Long-running or heavy jobs would need a separate worker pattern. |
| **Argon2 password hashing** | Strong default for credentials. | CPU cost per login (acceptable for admin-scale traffic). |

---

## What is incomplete / out of scope

- **AWS S3** — Not integrated as the primary blob store in this codebase; architecture doc describes the target upload flow.
- **External AI extraction service** — Not implemented as a separate HTTP integration; assignment diagram shows the intended pattern.
- **`gender` / `client` DDL** — Versioned here as [`db/migrations/001_gender_and_client.sql`](./db/migrations/001_gender_and_client.sql); not duplicated inside `ensure*Schema` functions yet.
- **End-to-end automated migration runner** — No `npm run migrate` CLI; schema is applied by the app and/or manual `psql` per `db/migrations/README.md`.
- **Production hardening** — Rate limiting, WAF, secrets manager, and backup/DR are deployment concerns, not fully codified here.

---

## Configuration notes

- `docker-compose.yml` provisions PostgreSQL 17 with a named volume.
- `DATABASE_URL` overrides individual `DB_*` variables when set.
- **`INTERNAL_API_TOKEN`** (optional, see `.env.example`) is for server automation only; do not expose to browsers.

---

## Licence / academic use

Add your institution’s honour statement or licence here if required.
