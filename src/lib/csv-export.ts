/**
 * Lightweight CSV export utility.
 * Exports an array of objects as a downloadable .csv file.
 */

interface ColumnDef {
  key: string;
  label: string;
  format?: (value: any, row: any) => string;
}

function escapeCSV(val: any): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  columns: ColumnDef[],
  filename: string
) {
  const header = columns.map((c) => escapeCSV(c.label)).join(",");
  const rows = data.map((row) =>
    columns
      .map((c) => {
        const raw = row[c.key];
        const formatted = c.format ? c.format(raw, row) : raw;
        return escapeCSV(formatted);
      })
      .join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
