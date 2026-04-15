import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";

/**
 * Returns a guard function that checks backend export entitlement
 * before allowing any CSV/XLSX export action.
 *
 * Usage:
 *   const guardExport = useExportGuard();
 *   const handleExport = async () => {
 *     if (!(await guardExport())) return;
 *     exportToCSV(data, cols, filename);
 *   };
 */
export function useExportGuard() {
  const { currentWorkspace } = useWorkspace();

  return useCallback(async (): Promise<boolean> => {
    if (!currentWorkspace) {
      toast.error("No workspace selected");
      return false;
    }

    const { data, error } = await supabase.rpc("assert_export_allowed", {
      _workspace_id: currentWorkspace.id,
    });

    if (error) {
      toast.error("Export check failed. Please try again.");
      return false;
    }

    const result = data as { allowed: boolean; error?: string } | null;
    if (!result?.allowed) {
      toast.error(result?.error || "Data export requires a Growth plan.");
      return false;
    }

    return true;
  }, [currentWorkspace]);
}
