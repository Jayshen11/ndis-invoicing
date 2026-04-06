# Architecture (high level)

This document satisfies the assignment requirement for an **architecture diagram**. Render the Mermaid blocks in [GitHub](https://github.blog/news-insights/product-news/github-now-supports-mermaid-diagrams-in-markdown/), [Mermaid Live Editor](https://mermaid.live), or paste into draw.io / Excalidraw / Lucidchart.

## Component diagram

```mermaid
flowchart TB
  subgraph Users["Users (browser)"]
    U[Operators / admins]
  end

  subgraph Next["Next.js application"]
    FE[Frontend\nReact App Router UI]
    API[API layer\n`src/app/api/*` route handlers]
    AUTH[Authentication & RBAC\nsession cookie + permission checks]
    FE --> API
    API --> AUTH
  end

  subgraph Data["Data & integrations"]
    PG[(PostgreSQL)]
    S3[(AWS S3\noptional / planned for durable file storage)]
    AI[AI extraction service\noptional / planned HTTP API]
  end

  U --> FE
  AUTH --> PG
  API --> PG
  API --> S3
  API --> AI
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

## S3 upload (target pattern)

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as Next.js API
  participant SVC as Service layer
  participant S3 as AWS S3

  B->>API: Request upload (authenticated)
  API->>SVC: RBAC + validation
  SVC->>S3: Presigned URL or PutObject
  S3-->>SVC: Object key / URL
  SVC->>SVC: Persist metadata reference in PostgreSQL (typical)
  API-->>B: Success response
```

## AI extraction (target pattern)

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as Next.js API
  participant SVC as Service layer
  participant S3 as AWS S3
  participant AI as External AI API
  participant DB as PostgreSQL

  B->>API: Trigger extraction job
  API->>SVC: Authorize + load context
  SVC->>S3: Fetch document (or pass signed URL)
  SVC->>AI: Structured extraction request
  AI-->>SVC: JSON fields / confidence
  SVC->>SVC: Validate + map to domain
  SVC->>DB: Store results + audit
  API-->>B: 200 with data envelope
```

**Note:** In this repository, **NDIS rate-set Excel** is parsed **in-process** on the API server; **S3** and a separate **AI extraction** service are shown as the intended enterprise extensions required by the assignment brief.
