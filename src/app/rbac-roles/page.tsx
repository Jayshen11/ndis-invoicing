import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { UserRolesManager } from "@/modules/user-role/components/UserRolesManager";

export const dynamic = "force-dynamic";

export default function RbacRolesPage() {
  return (
    <RequirePermission permission="user_roles.read">
      <UserRolesManager />
    </RequirePermission>
  );
}
