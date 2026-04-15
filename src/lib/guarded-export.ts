/**
 * Guarded export utilities.
 * Wraps CSV/XLSX exports with a backend entitlement check via
 * the assert_export_allowed RPC before allowing file generation.
 */
import { supabase } from "@/integrations/supabase/client";
import { exportToCSV } from "@/lib/csv-export";
import { exportToXLSX } from "@/lib/xlsx-export";
import { exportMultiSheetXLSX } from "@/lib/xlsx-export";
import { toast } from "sonner";

interface ColumnDef {
  key: string;
  label: string;
  format?: (value: any, row: any) => string;
}

async function assertExport(workspaceId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("assert_export_allowed", {
    _workspace_id: workspaceId,
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
}

export async function guardedExportToCSV<T extends Record<string, any>>(
  workspaceId: string,
  data: T[],
  columns: ColumnDef[],
  filename: string,
) {
  if (!(await assertExport(workspaceId))) return;
  exportToCSV(data, columns, filename);
}

export async function guardedExportToXLSX<T extends Record<string, any>>(
  workspaceId: string,
  data: T[],
  columns: ColumnDef[],
  filename: string,
  sheetName?: string,
) {
  if (!(await assertExport(workspaceId))) return;
  exportToXLSX(data, columns, filename, sheetName);
}

export async function guardedExportMultiSheetXLSX(
  workspaceId: string,
  sheets: { name: string; data: Record<string, any>[]; columns: ColumnDef[] }[],
  filename: string,
) {
  if (!(await assertExport(workspaceId))) return;
  exportMultiSheetXLSX(sheets, filename);
}
