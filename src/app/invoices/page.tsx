import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { InvoicesManager } from "@/modules/invoice/components/InvoicesManager";

export const dynamic = "force-dynamic";

export default function InvoicesPage() {
  return (
    <RequirePermission permission="invoices.read">
      <InvoicesManager />
    </RequirePermission>
  );
}
