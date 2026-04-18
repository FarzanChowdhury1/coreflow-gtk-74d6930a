import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export type WorkspaceModule = "vendor_management" | "subscription_management";

/**
 * Returns true if the current user can manage the given module in the
 * current workspace. Admins always pass; team members pass when they
 * have an explicit grant in workspace_module_access.
 */
export function useModuleAccess(module: WorkspaceModule) {
  const { user } = useAuth();
  const { currentWorkspace, currentRole } = useWorkspace();
  const isAdmin = currentRole === "admin";

  const { data: hasGrant = false, isLoading } = useQuery({
    queryKey: ["module-access", currentWorkspace?.id, user?.id, module],
    enabled: !!currentWorkspace?.id && !!user?.id && !isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_module_access")
        .select("id")
        .eq("workspace_id", currentWorkspace!.id)
        .eq("user_id", user!.id)
        .eq("module", module)
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
  });

  return {
    canManage: isAdmin || hasGrant,
    isAdmin,
    isLoading: !isAdmin && isLoading,
  };
}
