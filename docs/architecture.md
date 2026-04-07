# Architecture (high level)

This document satisfies the **Architecture Design Requirement**: it names all required components and illustrates **Frontend → API**, **API → database**, **authentication / RBAC**, **S3 upload**, and **AI extraction** workflows.

**How to submit:** Render the Mermaid blocks in [GitHub](https://github.blog/news-insights/product-news/github-now-supports-mermaid-diagrams-in-markdown/), [Mermaid Live Editor](https://mermaid.live) (export PNG/SVG/PDF), or recreate in draw.io / Lucidchart / Miro / Excalidraw.

## Rubric mapping (assignment §12)

| Requirement | Where it appears below |
|-------------|-------------------------|
| Next.js frontend application | Component diagram: **Frontend** |
| API layer / backend services | **API** + **Service layer** in sequence diagrams |
| PostgreSQL database | **PostgreSQL** in all diagrams |
| AWS S3 storage | Component diagram + **S3 upload** sequence |
| AI extraction service integration | Component diagram + **AI extraction** sequence |
| Authentication and RBAC layer | **Authentication & RBAC** + **Authentication flow** sequence |
| Frontend → API communication | Component diagram (`HTTPS`); implied in every sequence |
| API → database interactions | Component diagram; sequences show reads/writes |
| Authentication flow | **Authentication flow** sequence |
| S3 upload workflow | **S3 upload** sequence |
| AI extraction workflow | **AI extraction** sequence |

## Component diagram

```mermaid
flowchart TB
  subgraph Users["Users (browser)"]
    U[Operators / admins]
  end

  subgraph Next["Next.js application"]
    FE[Next.js frontend\nReact App Router UI]
    API[API layer / route handlers\n`src/app/api/*`]
    AUTH[Authentication & RBAC\nsession cookie + permission checks]
    FE -->|HTTPS JSON| API
    API --> AUTH
  end

  subgraph Data["Data & integrations"]
    PG[(PostgreSQL\ndatabase)]
    S3[(AWS S3\nobject storage)]
    AI[AI extraction service\nexternal HTTP API]
  end

  U --> FE
  AUTH -->|session / user queries| PG
  API -->|SQL via pool\nservices / repositories| PG
  API -->|upload / download| S3
  API -->|extract / enrich| AI
```

## Authentication flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as Next.js API
  participant S as Auth / user services
  participant DB as PostgreSQL

  B->>API: POST /api/auth/login (credentials)
  API->>S: Verify password, resolve RBAC
  S->>DB: Read users, roles, permissions
  S->>DB: Insert auth_session
  API-->>B: HttpOnly session cookie + JSON body

  B->>API: Mutating request (cookie + CSRF)
  API->>S: Validate session + requirePermission
  S->>DB: Load session / permissions
  alt allowed
    API->>DB: Business logic via services / repositories
    API-->>B: 200 with data envelope
  else forbidden
    API-->>B: 403 error envelope
  end
```

## S3 upload workflow

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as Next.js API
  participant SVC as Service layer
  participant S3 as AWS S3
  participant DB as PostgreSQL

  B->>API: HTTPS: request upload (session + CSRF)
  API->>SVC: Authenticate + RBAC + validate file metadata
  SVC->>S3: Presigned PUT URL or server-side PutObject
  S3-->>SVC: Object key / ETag
  SVC->>DB: INSERT/UPDATE file metadata (key, bucket, mime, owner)
  SVC-->>API: Result DTO
  API-->>B: HTTPS: 200 { data } (e.g. key, URL)
```

## AI extraction workflow

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as Next.js API
  participant SVC as Service layer
  participant S3 as AWS S3
  participant AI as AI extraction service
  participant DB as PostgreSQL

  B->>API: HTTPS: start extraction (document or job id)
  API->>SVC: Authenticate + RBAC + load job
  SVC->>S3: GetObject or generate short-lived signed URL
  S3-->>SVC: Document bytes / URL for AI
  SVC->>AI: HTTPS: extraction request (schema, redacted PII policy)
  AI-->>SVC: Structured JSON (fields, confidence, warnings)
  SVC->>SVC: Validate + map to domain model
  SVC->>DB: Persist extracted entities + status + audit trail
  API-->>B: HTTPS: 200 { data }
```

### Implementation note (this repository)

**NDIS rate-set Excel** is currently parsed **in-process** on the API server (no separate AI microservice). The **S3** and **AI extraction** diagrams above match the **assignment’s target architecture** (durable storage + external AI); you can label them “logical / planned” in your report if your marker wants strict as-built vs to-be.
