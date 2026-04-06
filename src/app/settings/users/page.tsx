import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { UsersManager } from "@/modules/app-user/components/UsersManager";

export const dynamic = "force-dynamic";

export default function SettingsUsersPage() {
  return (
    <RequirePermission permission="users.read">
      <UsersManager />
    </RequirePermission>
  );
}
