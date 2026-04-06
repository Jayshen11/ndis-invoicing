import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

// Replace this with a typed schema as tables are introduced.
type Database = Record<string, Record<string, unknown>>;

type DatabaseStatus =
  | {
      state: "connected";
      checkedAt: string;
    }
  | {
      state: "configuration_required";
    }
  | {
      state: "unavailable";
    };

class DatabaseConfigurationError extends Error {}

// Cache the pool/client across hot reloads in development.
const globalForDatabase = globalThis as typeof globalThis & {
  dbPool?: Pool;
  dbClient?: Kysely<Database>;
};

// Reads required env values and throws a configuration-specific error when missing.
function getRequiredSetting(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;

  // SEC: Fail fast on missing database configuration instead of using unsafe defaults.
  if (!value) {
    throw new DatabaseConfigurationError(
      `Missing required database setting: ${name}`,
    );
  }

  return value;
}

function getPort(): number {
  const parsedPort = Number(getRequiredSetting("DB_PORT", "5432"));

  // Validate env input before building the database connection.
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new DatabaseConfigurationError("DB_PORT must be 1-65535");
  }

  return parsedPort;
}

// Prefer a full DATABASE_URL when provided, otherwise fall back to DB_* values.
function getConnectionString(): string | undefined {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    return undefined;
  }

  const parsedUrl = new URL(databaseUrl);

  // Allowlist PostgreSQL connection strings only.
  if (
    parsedUrl.protocol !== "postgres:" &&
    parsedUrl.protocol !== "postgresql:"
  ) {
    throw new DatabaseConfigurationError(
      "DATABASE_URL must use postgres:// or postgresql://",
    );
  }

  return parsedUrl.toString();
}

// Builds the shared pg pool that Kysely uses under the hood.
function getPool(): Pool {
  if (globalForDatabase.dbPool) {
    return globalForDatabase.dbPool;
  }

  const connectionString = getConnectionString();
  const pool = new Pool({
    application_name: "ndis-invoicing-web",
    connectionString,
    connectionTimeoutMillis: 5_000,
    database: connectionString ? undefined : getRequiredSetting("DB_NAME"),
    host: connectionString
      ? undefined
      : getRequiredSetting("DB_HOST", "127.0.0.1"),
    idleTimeoutMillis: 30_000,
    max: 10,
    password: connectionString ? undefined : getRequiredSetting("DB_PASSWORD"),
    port: connectionString ? undefined : getPort(),
    user: connectionString ? undefined : getRequiredSetting("DB_USER"),
  });

  // SEC: Reuse a single pool during development to avoid exhausting connections on hot reload.
  if (process.env.NODE_ENV !== "production") {
    globalForDatabase.dbPool = pool;
  }

  return pool;
}

// Creates the main Kysely client for queries elsewhere in the app.
function createDbClient() {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: getPool(),
    }),
  });
}

// Export one shared DB client instance for the entire app process.
export const db = globalForDatabase.dbClient ?? createDbClient();

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.dbClient = db;
}

// Runs a lightweight query so the UI can report whether the database is reachable.
export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  try {
    const result = await sql<{ checked_at: string }>`
      select now()::text as checked_at
    `.execute(db);

    return {
      state: "connected",
      checkedAt: result.rows[0]?.checked_at ?? new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return {
        state: "configuration_required",
      };
    }

    // Keep server logs detailed while returning generic status to the UI.
    console.error("Database connectivity check failed.", error);

    return {
      state: "unavailable",
    };
  }
}
