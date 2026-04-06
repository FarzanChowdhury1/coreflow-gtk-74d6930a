/**
 * XLSX export utility using SheetJS.
 * Mirrors the CSV export API for consistency.
 */
import * as XLSX from "xlsx";

interface ColumnDef {
  key: string;
  label: string;
  format?: (value: any, row: any) => string;
}

export function exportToXLSX<T extends Record<string, any>>(
  data: T[],
  columns: ColumnDef[],
  filename: string,
  sheetName = "Sheet1"
) {
  const header = columns.map((c) => c.label);
  const rows = data.map((row) =>
    columns.map((c) => {
      const raw = row[c.key];
      return c.format ? c.format(raw, row) : raw ?? "";
    })
  );

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

  // Auto-width columns
  const colWidths = columns.map((c, i) => {
    let max = c.label.length;
    rows.forEach((r) => {
      const len = String(r[i] ?? "").length;
      if (len > max) max = len;
    });
    return { wch: Math.min(max + 2, 50) };
  });
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Multi-sheet XLSX export — used by workspace-level export center.
 */
export function exportMultiSheetXLSX(
  sheets: { name: string; data: Record<string, any>[]; columns: ColumnDef[] }[],
  filename: string
) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const header = sheet.columns.map((c) => c.label);
    const rows = sheet.data.map((row) =>
      sheet.columns.map((c) => {
        const raw = row[c.key];
        return c.format ? c.format(raw, row) : raw ?? "";
      })
    );
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws["!cols"] = sheet.columns.map((c, i) => {
      let max = c.label.length;
      rows.forEach((r) => {
        const len = String(r[i] ?? "").length;
        if (len > max) max = len;
      });
      return { wch: Math.min(max + 2, 50) };
    });
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
