import { Navigate } from "react-router-dom";
import { useWorkspace } from "@/contexts/WorkspaceContext";

/**
 * Route-level guard that redirects non-admin users to /dashboard.
 * Use this to wrap any page component that should only be accessible by admins.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { currentRole } = useWorkspace();

  if (currentRole !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
