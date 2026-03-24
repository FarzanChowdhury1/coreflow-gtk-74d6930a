import { Navigate } from "react-router-dom";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { useAuth } from "@/contexts/AuthContext";

export function PlatformAdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { isPlatformAdmin, loading } = usePlatformAdmin();

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isPlatformAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
