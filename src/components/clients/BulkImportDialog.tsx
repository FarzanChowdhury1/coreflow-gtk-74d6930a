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
import { Upload, Download, AlertTriangle, CheckCircle2, X, Copy } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { companySchema, contactSchema } from "@/lib/validations";
import type { Tables } from "@/integrations/supabase/types";

type Company = Tables<"companies">;
type Contact = Tables<"contacts">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Company[];
  contacts: Contact[];
}

type ImportType = "companies" | "contacts";
type RowStatus = "valid" | "invalid" | "duplicate";

interface ParsedRow {
  rowNum: number;
  data: Record<string, string>;
  errors: string[];
  status: RowStatus;
}

const COMPANY_HEADERS = ["legal_name", "bin", "address", "phone", "notes", "website"];
const CONTACT_HEADERS = ["full_name", "email", "phone", "alt_phone", "designation", "company_name", "notes", "website", "linkedin"];

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

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
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
    company_id: "",
    notes: data.notes || "",
  });
  if (result.success) return [];
  return result.error.issues.map((i) => i.message);
}

export function BulkImportDialog({ open, onOpenChange, companies, contacts }: Props) {
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [importType, setImportType] = useState<ImportType>("companies");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    duplicates: number;
    invalid: number;
    dbErrors: number;
    errorDetails: string[];
  }>({ imported: 0, duplicates: 0, invalid: 0, dbErrors: 0, errorDetails: [] });

  const reset = useCallback(() => {
    setParsedRows([]);
    setStep("upload");
    setImportResult({ imported: 0, duplicates: 0, invalid: 0, dbErrors: 0, errorDetails: [] });
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

      // Build existing-data indexes for duplicate detection
      const existingCompanyNames = new Set(
        companies.filter((c) => !c.deleted_at).map((c) => norm(c.legal_name))
      );
      const existingContactKeys = new Set(
        contacts.filter((c) => !c.deleted_at).map((c) => {
          // key = normalized name + email (if present)
          const email = c.email ? norm(c.email) : "";
          return `${norm(c.full_name)}||${email}`;
        })
      );

      // Track intra-CSV duplicates
      const seenInCSV = new Set<string>();

      const parsed: ParsedRow[] = rows.slice(1).map((row, idx) => {
        const data: Record<string, string> = {};
        expectedHeaders.forEach((h) => {
          const colIdx = headers.indexOf(h);
          data[h] = colIdx >= 0 ? (row[colIdx] || "") : "";
        });

        const errors = importType === "companies"
          ? validateCompanyRow(data)
          : validateContactRow(data);

        // If validation already failed, return early as invalid
        if (errors.length > 0) {
          return { rowNum: idx + 2, data, errors, status: "invalid" as RowStatus };
        }

        // --- Duplicate detection ---
        if (importType === "companies") {
          const key = norm(data.legal_name);

          // Check against existing workspace data
          if (existingCompanyNames.has(key)) {
            return { rowNum: idx + 2, data, errors: [`Duplicate: company "${data.legal_name}" already exists in workspace`], status: "duplicate" as RowStatus };
          }
          // Check intra-CSV duplicate
          if (seenInCSV.has(key)) {
            return { rowNum: idx + 2, data, errors: [`Duplicate: company "${data.legal_name}" appears earlier in this CSV`], status: "duplicate" as RowStatus };
          }
          seenInCSV.add(key);
        } else {
          // Contacts: duplicate key = name + email
          const email = data.email ? norm(data.email) : "";
          const key = `${norm(data.full_name)}||${email}`;

          if (existingContactKeys.has(key)) {
            return { rowNum: idx + 2, data, errors: [`Duplicate: contact "${data.full_name}"${data.email ? ` (${data.email})` : ""} already exists in workspace`], status: "duplicate" as RowStatus };
          }
          if (seenInCSV.has(key)) {
            return { rowNum: idx + 2, data, errors: [`Duplicate: contact "${data.full_name}"${data.email ? ` (${data.email})` : ""} appears earlier in this CSV`], status: "duplicate" as RowStatus };
          }
          seenInCSV.add(key);

          // Company name resolution
          if (data.company_name) {
            const normalizedName = norm(data.company_name);
            const matches = companies.filter(
              (c) => !c.deleted_at && norm(c.legal_name) === normalizedName
            );
            if (matches.length === 0) {
              return { rowNum: idx + 2, data, errors: [`Company "${data.company_name}" not found in workspace`], status: "invalid" as RowStatus };
            }
            if (matches.length > 1) {
              return { rowNum: idx + 2, data, errors: [`Ambiguous: multiple companies match "${data.company_name}"`], status: "invalid" as RowStatus };
            }
          }
        }

        return { rowNum: idx + 2, data, errors: [], status: "valid" as RowStatus };
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

  const validRows = parsedRows.filter((r) => r.status === "valid");
  const duplicateRows = parsedRows.filter((r) => r.status === "duplicate");
  const invalidRows = parsedRows.filter((r) => r.status === "invalid");

  const handleImport = async () => {
    if (!currentWorkspace || !user || validRows.length === 0) return;
    setImporting(true);
    const errorDetails: string[] = [];
    let imported = 0;
    let dbErrors = 0;

    if (importType === "companies") {
      for (const row of validRows) {
        const socials: { platform: string; value: string }[] = [];
        if (row.data.website?.trim()) socials.push({ platform: "website", value: row.data.website.trim() });
        const { error } = await supabase.from("companies").insert({
          workspace_id: currentWorkspace.id,
          legal_name: row.data.legal_name.trim(),
          bin: row.data.bin?.trim() || null,
          address: row.data.address?.trim() || null,
          phone: row.data.phone?.trim() || null,
          notes: row.data.notes?.trim() || null,
          socials,
        } as any);
        if (error) {
          dbErrors++;
          errorDetails.push(`Row ${row.rowNum}: ${error.message}`);
        } else {
          imported++;
        }
      }
    } else {
      for (const row of validRows) {
        let companyId: string | null = null;
        if (row.data.company_name) {
          const normalizedName = norm(row.data.company_name);
          const match = companies.find(
            (c) => !c.deleted_at && norm(c.legal_name) === normalizedName
          );
          companyId = match?.id ?? null;
        }

        const primary = row.data.phone?.trim() || "";
        const alternate = row.data.alt_phone?.trim() || "";
        const phonesArr: { label: string; number: string }[] = [];
        if (primary) phonesArr.push({ label: "primary", number: primary });
        if (alternate) phonesArr.push({ label: "alternate", number: alternate });

        const socials: { platform: string; value: string }[] = [];
        if (row.data.website?.trim()) socials.push({ platform: "website", value: row.data.website.trim() });
        if (row.data.linkedin?.trim()) socials.push({ platform: "linkedin", value: row.data.linkedin.trim() });

        const { error } = await supabase.from("contacts").insert({
          workspace_id: currentWorkspace.id,
          full_name: row.data.full_name.trim(),
          email: row.data.email?.trim() || null,
          phone: primary || null,
          alt_phone: alternate || null,
          phones: phonesArr,
          socials,
          designation: row.data.designation?.trim() || null,
          company_id: companyId,
          notes: row.data.notes?.trim() || null,
        } as any);
        if (error) {
          dbErrors++;
          errorDetails.push(`Row ${row.rowNum}: ${error.message}`);
        } else {
          imported++;
        }
      }
    }

    // Write audit log entry
    try {
      await supabase.from("audit_logs").insert({
        workspace_id: currentWorkspace.id,
        actor_id: user.id,
        action: "bulk_import",
        entity_type: importType === "companies" ? "company" : "contact",
        metadata: {
          import_type: importType,
          total_rows: parsedRows.length,
          imported,
          duplicates_skipped: duplicateRows.length,
          validation_skipped: invalidRows.length,
          db_errors: dbErrors,
        },
      });
    } catch {
      // Audit failure should not block import result
    }

    setImportResult({
      imported,
      duplicates: duplicateRows.length,
      invalid: invalidRows.length,
      dbErrors,
      errorDetails,
    });
    setStep("result");
    setImporting(false);
    queryClient.invalidateQueries({ queryKey: ["companies"] });
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const statusIcon = (s: RowStatus) => {
    if (s === "valid") return <CheckCircle2 className="h-3.5 w-3.5 text-primary" />;
    if (s === "duplicate") return <Copy className="h-3.5 w-3.5 text-amber-500" />;
    return <X className="h-3.5 w-3.5 text-destructive" />;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import</DialogTitle>
          <DialogDescription>
            Import companies or contacts from a CSV file. Duplicates are detected and skipped automatically.
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
                Max 500 rows, 2MB. Duplicates are detected by name{importType === "contacts" ? " + email" : ""} and skipped.
                {importType === "contacts" && " Use company_name column to link contacts to existing companies."}
              </p>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{parsedRows.length} rows parsed</Badge>
              {validRows.length > 0 && (
                <Badge className="bg-primary/10 text-primary border-primary/20">
                  {validRows.length} ready
                </Badge>
              )}
              {duplicateRows.length > 0 && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                  {duplicateRows.length} duplicates
                </Badge>
              )}
              {invalidRows.length > 0 && (
                <Badge variant="destructive">{invalidRows.length} invalid</Badge>
              )}
            </div>

            {(duplicateRows.length > 0 || invalidRows.length > 0) && (
              <div className="rounded-md border border-muted bg-muted/30 p-3 space-y-1 max-h-40 overflow-y-auto">
                {duplicateRows.length > 0 && (
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1 mb-1">
                    <Copy className="h-4 w-4" /> {duplicateRows.length} duplicate{duplicateRows.length > 1 ? "s" : ""} will be skipped
                  </p>
                )}
                {invalidRows.length > 0 && (
                  <p className="text-sm font-medium text-destructive flex items-center gap-1 mb-1">
                    <AlertTriangle className="h-4 w-4" /> {invalidRows.length} invalid row{invalidRows.length > 1 ? "s" : ""} will be skipped
                  </p>
                )}
                {[...duplicateRows, ...invalidRows].map((r) => (
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
                    <tr
                      key={r.rowNum}
                      className={
                        r.status === "invalid" ? "bg-destructive/5" :
                        r.status === "duplicate" ? "bg-amber-50 dark:bg-amber-950/20" : ""
                      }
                    >
                      <td className="px-2 py-1">{r.rowNum}</td>
                      <td className="px-2 py-1">{statusIcon(r.status)}</td>
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
            <div className="rounded-md border p-4 space-y-2">
              {importResult.imported > 0 && (
                <p className="text-sm font-medium text-primary flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" /> {importResult.imported} {importType} imported successfully
                </p>
              )}
              {importResult.duplicates > 0 && (
                <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1">
                  <Copy className="h-4 w-4" /> {importResult.duplicates} skipped as duplicates
                </p>
              )}
              {importResult.invalid > 0 && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <X className="h-4 w-4" /> {importResult.invalid} skipped (validation errors)
                </p>
              )}
              {importResult.dbErrors > 0 && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" /> {importResult.dbErrors} failed during insert
                </p>
              )}
            </div>

            {importResult.errorDetails.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 max-h-40 overflow-y-auto space-y-1">
                {importResult.errorDetails.map((e, i) => (
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
