import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { ProvidersManager } from "@/modules/provider/components/ProvidersManager";

export const dynamic = "force-dynamic";

export default function ProvidersPage() {
  return (
    <RequirePermission permission="providers.read">
      <ProvidersManager />
    </RequirePermission>
  );
}
