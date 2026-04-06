import { sql } from "kysely";
import { db } from "@/db/client";
import type { RbacPermissionApiRow } from "@/modules/user-role/permissions-catalog";

export async function countRbacPermissionRows(): Promise<number> {
  const result = await sql<{ count: string }>`
    select count(*)::text as count
    from rbac_permission
  `.execute(db);

  const raw = result.rows[0]?.count ?? "0";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function listRbacPermissionRows(): Promise<RbacPermissionApiRow[]> {
  const result = await sql<{
    id: number;
    code: string;
    label: string;
    created_at: string;
  }>`
    select
      id,
      code,
      label,
      created_at::text as created_at
    from rbac_permission
    order by id asc
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    created_at: row.created_at,
  }));
}
