import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { ClientsManager } from "@/modules/client/components/ClientsManager";

export const dynamic = "force-dynamic";

export default function ClientsPage() {
  return (
    <RequirePermission permission="clients.read">
      <ClientsManager />
    </RequirePermission>
  );
}
