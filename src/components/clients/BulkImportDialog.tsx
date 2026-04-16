import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Download, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { companySchema, contactSchema } from "@/lib/validations";
import type { Tables } from "@/integrations/supabase/types";

type Company = Tables<"companies">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Company[];
}

type ImportType = "companies" | "contacts";

interface ParsedRow {
  rowNum: number;
  data: Record<string, string>;
  errors: string[];
  valid: boolean;
}

const COMPANY_HEADERS = ["legal_name", "bin", "address", "phone", "notes"];
const CONTACT_HEADERS = ["full_name", "email", "phone", "alt_phone", "designation", "company_name", "notes"];

function downloadTemplate(type: ImportType) {
  const headers = type === "companies" ? COMPANY_HEADERS : CONTACT_HEADERS;
  const example = type === "companies"
    ? ["Acme Corp", "1234567890123", "123 Main St", "+8801712345678", "Important client"]
    : ["Jane Doe", "jane@example.com", "+8801712345678", "", "CEO", "Acme Corp", "Key contact"];
  const csv = [headers.join(","), example.join(",")].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${type}-import-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current.trim());
        current = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(current.trim());
        if (row.some((c) => c !== "")) rows.push(row);
        row = [];
        current = "";
      } else {
        current += ch;
      }
    }
  }
  row.push(current.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function validateCompanyRow(data: Record<string, string>): string[] {
  const result = companySchema.safeParse({
    legal_name: data.legal_name || "",
    bin: data.bin || "",
    address: data.address || "",
    phone: data.phone || "",
    notes: data.notes || "",
  });
  if (result.success) return [];
  return result.error.issues.map((i) => i.message);
}

function validateContactRow(data: Record<string, string>): string[] {
  const result = contactSchema.safeParse({
    full_name: data.full_name || "",
    email: data.email || "",
    phone: data.phone || "",
    alt_phone: data.alt_phone || "",
    designation: data.designation || "",
    company_id: "", // resolved later
    notes: data.notes || "",
  });
  if (result.success) return [];
  return result.error.issues.map((i) => i.message);
}

export function BulkImportDialog({ open, onOpenChange, companies }: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [importType, setImportType] = useState<ImportType>("companies");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; errors: string[] }>({ imported: 0, failed: 0, errors: [] });

  const reset = useCallback(() => {
    setParsedRows([]);
    setStep("upload");
    setImportResult({ imported: 0, failed: 0, errors: [] });
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      toast.error("Please upload a .csv file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("File too large. Maximum 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length < 2) {
        toast.error("CSV must have a header row and at least one data row");
        return;
      }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      const expectedHeaders = importType === "companies" ? COMPANY_HEADERS : CONTACT_HEADERS;
      const requiredField = importType === "companies" ? "legal_name" : "full_name";
      if (!headers.includes(requiredField)) {
        toast.error(`CSV must include "${requiredField}" column. Download the template for the correct format.`);
        return;
      }

      const parsed: ParsedRow[] = rows.slice(1).map((row, idx) => {
        const data: Record<string, string> = {};
        expectedHeaders.forEach((h) => {
          const colIdx = headers.indexOf(h);
          data[h] = colIdx >= 0 ? (row[colIdx] || "") : "";
        });

        const errors = importType === "companies"
          ? validateCompanyRow(data)
          : validateContactRow(data);

        // Check for company_name resolution for contacts
        if (importType === "contacts" && data.company_name) {
          const match = companies.find(
            (c) => c.legal_name.toLowerCase() === data.company_name.toLowerCase() && !c.deleted_at
          );
          if (!match) {
            errors.push(`Company "${data.company_name}" not found in workspace`);
          }
        }

        return { rowNum: idx + 2, data, errors, valid: errors.length === 0 };
      });

      if (parsed.length > 500) {
        toast.error("Maximum 500 rows per import");
        return;
      }

      setParsedRows(parsed);
      setStep("preview");
    };
    reader.readAsText(file);
  };

  const validRows = parsedRows.filter((r) => r.valid);
  const invalidRows = parsedRows.filter((r) => !r.valid);

  const handleImport = async () => {
    if (!currentWorkspace || validRows.length === 0) return;
    setImporting(true);
    const errors: string[] = [];
    let imported = 0;

    if (importType === "companies") {
      for (const row of validRows) {
        const { error } = await supabase.from("companies").insert({
          workspace_id: currentWorkspace.id,
          legal_name: row.data.legal_name.trim(),
          bin: row.data.bin?.trim() || null,
          address: row.data.address?.trim() || null,
          phone: row.data.phone?.trim() || null,
          notes: row.data.notes?.trim() || null,
        });
        if (error) {
          errors.push(`Row ${row.rowNum}: ${error.message}`);
        } else {
          imported++;
        }
      }
    } else {
      for (const row of validRows) {
        let companyId: string | null = null;
        if (row.data.company_name) {
          const match = companies.find(
            (c) => c.legal_name.toLowerCase() === row.data.company_name.toLowerCase() && !c.deleted_at
          );
          companyId = match?.id ?? null;
        }

        const { error } = await supabase.from("contacts").insert({
          workspace_id: currentWorkspace.id,
          full_name: row.data.full_name.trim(),
          email: row.data.email?.trim() || null,
          phone: row.data.phone?.trim() || null,
          alt_phone: row.data.alt_phone?.trim() || null,
          designation: row.data.designation?.trim() || null,
          company_id: companyId,
          notes: row.data.notes?.trim() || null,
        });
        if (error) {
          errors.push(`Row ${row.rowNum}: ${error.message}`);
        } else {
          imported++;
        }
      }
    }

    setImportResult({ imported, failed: errors.length, errors });
    setStep("result");
    setImporting(false);
    queryClient.invalidateQueries({ queryKey: ["companies"] });
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import</DialogTitle>
          <DialogDescription>
            Import companies or contacts from a CSV file. Download the template first to ensure correct format.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <Tabs value={importType} onValueChange={(v) => { setImportType(v as ImportType); reset(); }}>
              <TabsList className="w-full">
                <TabsTrigger value="companies" className="flex-1">Companies</TabsTrigger>
                <TabsTrigger value="contacts" className="flex-1">Contacts</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
              <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Upload a CSV file with {importType === "companies" ? "company" : "contact"} data
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadTemplate(importType)}>
                  <Download className="h-4 w-4 mr-1" /> Download Template
                </Button>
                <Button size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" /> Choose File
                </Button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
              <p className="text-xs text-muted-foreground">
                Max 500 rows, 2MB. {importType === "contacts" && "Use company_name column to link contacts to existing companies."}
              </p>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{parsedRows.length} rows parsed</Badge>
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                {validRows.length} valid
              </Badge>
              {invalidRows.length > 0 && (
                <Badge variant="destructive">{invalidRows.length} invalid</Badge>
              )}
            </div>

            {invalidRows.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1 max-h-40 overflow-y-auto">
                <p className="text-sm font-medium text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" /> Invalid rows (will be skipped)
                </p>
                {invalidRows.map((r) => (
                  <p key={r.rowNum} className="text-xs text-muted-foreground">
                    Row {r.rowNum}: {r.errors.join("; ")}
                  </p>
                ))}
              </div>
            )}

            <div className="rounded-md border max-h-60 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Row</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    {(importType === "companies" ? COMPANY_HEADERS : CONTACT_HEADERS).map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 50).map((r) => (
                    <tr key={r.rowNum} className={r.valid ? "" : "bg-destructive/5"}>
                      <td className="px-2 py-1">{r.rowNum}</td>
                      <td className="px-2 py-1">
                        {r.valid
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                          : <X className="h-3.5 w-3.5 text-destructive" />}
                      </td>
                      {(importType === "companies" ? COMPANY_HEADERS : CONTACT_HEADERS).map((h) => (
                        <td key={h} className="px-2 py-1 max-w-[120px] truncate">{r.data[h] || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 50 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Showing first 50 of {parsedRows.length} rows
                </p>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0 || importing}
              >
                {importing ? "Importing…" : `Import ${validRows.length} ${importType}`}
              </Button>
            </div>
          </div>
        )}

        {step === "result" && (
          <div className="space-y-4">
            <div className="rounded-md border p-4 text-center space-y-2">
              {importResult.imported > 0 && (
                <p className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center justify-center gap-1">
                  <CheckCircle2 className="h-4 w-4" /> {importResult.imported} {importType} imported successfully
                </p>
              )}
              {importResult.failed > 0 && (
                <p className="text-sm text-destructive flex items-center justify-center gap-1">
                  <AlertTriangle className="h-4 w-4" /> {importResult.failed} rows failed
                </p>
              )}
            </div>

            {importResult.errors.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 max-h-40 overflow-y-auto space-y-1">
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{e}</p>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={() => handleClose(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
