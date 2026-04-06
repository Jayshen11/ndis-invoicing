import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { GendersManager } from "@/modules/gender/components/GendersManager";

export const dynamic = "force-dynamic";

export default function GendersPage() {
  return (
    <RequirePermission permission="genders.read">
      <GendersManager />
    </RequirePermission>
  );
}
