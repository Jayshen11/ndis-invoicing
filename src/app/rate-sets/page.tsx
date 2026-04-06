import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { RateSetsManager } from "@/modules/rate-set/components/RateSetsManager";

export const dynamic = "force-dynamic";

export default function RateSetsPage() {
  return (
    <RequirePermission permission="rate_sets.read">
      <RateSetsManager />
    </RequirePermission>
  );
}
