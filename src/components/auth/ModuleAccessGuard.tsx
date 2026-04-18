import { Navigate } from "react-router-dom";
import { useModuleAccess, type WorkspaceModule } from "@/hooks/use-module-access";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  module: WorkspaceModule;
  children: React.ReactNode;
}

/**
 * Route-level guard for delegated module access. Allows admins and members
 * with an explicit grant. Others get a clear message.
 */
export function ModuleAccessGuard({ module, children }: Props) {
  const { canManage, isLoading, isAdmin } = useModuleAccess(module);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!canManage) {
    if (isAdmin) return <Navigate to="/dashboard" replace />;
    return (
      <div className="max-w-lg mx-auto mt-12">
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <h2 className="text-base font-semibold text-foreground">Access not granted</h2>
            <p className="text-sm text-muted-foreground">
              You don't have permission to manage this module. Ask a workspace admin
              to grant you access from Settings → Module Access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
