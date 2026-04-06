import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { AuditLogsManager } from "@/modules/audit-log/components/AuditLogsManager";

export const dynamic = "force-dynamic";

export default function AuditLogsPage() {
  return (
    <RequirePermission permission="audit_logs.read">
      <AuditLogsManager />
    </RequirePermission>
  );
}
