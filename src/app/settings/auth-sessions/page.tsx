import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { AuthSessionsManager } from "@/modules/auth-session/components/AuthSessionsManager";

export const dynamic = "force-dynamic";

export default function AuthSessionsPage() {
  return (
    <RequirePermission permission="auth_sessions.read">
      <AuthSessionsManager />
    </RequirePermission>
  );
}
