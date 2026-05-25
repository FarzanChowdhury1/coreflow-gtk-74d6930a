import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Download, Plus, Trash2 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { exportInvoicePdf } from "@/lib/invoice-pdf";
import { resolveWorkspaceIssuer } from "@/lib/workspace-issuer";

// Bangladesh BIN: exactly 13 alphanumeric characters
const BIN_REGEX = /^[0-9A-Za-z]{13}$/;

interface MushakFields {
  enabled: boolean;
  vat_reg_no: string;
  challan_no: string;
  hs_code: string;
  buyer_address: string;
  notes: string;
}

function readMushak(raw: unknown): MushakFields {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const has = Object.keys(m).length > 0;
  return {
    enabled: has,
    vat_reg_no: typeof m.vat_reg_no === "string" ? m.vat_reg_no : "",
    challan_no: typeof m.challan_no === "string" ? m.challan_no : "",
    hs_code: typeof m.hs_code === "string" ? m.hs_code : "",
    buyer_address: typeof m.buyer_address === "string" ? m.buyer_address : "",
    notes: typeof m.notes === "string" ? m.notes : "",
  };
}

/** Returns null when valid, or an error message describing the first problem. */
function validateMushak(m: MushakFields): string | null {
  if (!m.enabled) return null;
  const vat = m.vat_reg_no.trim();
  const challan = m.challan_no.trim();
  if (!vat) return "VAT Registration No (BIN) is required when Mushak 6.3 is enabled";
  if (!BIN_REGEX.test(vat)) return "VAT Registration No must be exactly 13 alphanumeric characters";
  if (!challan) return "Challan No is required when Mushak 6.3 is enabled";
  if (challan.length > 64) return "Challan No must be 64 characters or fewer";
  if (m.hs_code && m.hs_code.length > 32) return "HS Code must be 32 characters or fewer";
  if (m.buyer_address && m.buyer_address.length > 500) return "Buyer address must be 500 characters or fewer";
  if (m.notes && m.notes.length > 1000) return "Notes must be 1000 characters or fewer";
  return null;
}

function buildMushakPayload(m: MushakFields): Record<string, string> {
  if (!m.enabled) return {};
  const out: Record<string, string> = {
    vat_reg_no: m.vat_reg_no.trim(),
    challan_no: m.challan_no.trim(),
  };
  if (m.hs_code.trim()) out.hs_code = m.hs_code.trim();
  if (m.buyer_address.trim()) out.buyer_address = m.buyer_address.trim();
  if (m.notes.trim()) out.notes = m.notes.trim();
  return out;
}

interface Props {
  invoice: Tables<"invoices">;
  onBack: () => void;
  onUpdated: () => void;
}

interface LineItem {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  sort_order: number;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  partially_paid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  void: "bg-destructive/10 text-destructive",
};

export function InvoiceDetail({ invoice, onBack, onUpdated }: Props) {
  const { currentWorkspace, currentRole } = useWorkspace();
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [mushak, setMushak] = useState<MushakFields>(() => readMushak(invoice.mushak_6_3));
  const isDraft = invoice.status === "draft";

  // Re-sync mushak state if a different invoice is loaded into the same instance
  useEffect(() => {
    setMushak(readMushak(invoice.mushak_6_3));
  }, [invoice.id, invoice.mushak_6_3]);

  const updateMushak = <K extends keyof MushakFields>(field: K, value: MushakFields[K]) => {
    setMushak((prev) => ({ ...prev, [field]: value }));
  };

  const fetchLineItems = useCallback(async () => {
    const { data } = await supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invoice.id)
      .order("sort_order");
    if (data) setLineItems(data.map((d) => ({ ...d, amount: Number(d.amount), quantity: Number(d.quantity), unit_price: Number(d.unit_price) })));
  }, [invoice.id]);

  useEffect(() => { fetchLineItems(); }, [fetchLineItems]);

  const addLine = () => {
    setLineItems((prev) => [
      ...prev,
      { description: "", quantity: 1, unit_price: 0, amount: 0, sort_order: prev.length },
    ]);
  };

  const updateLine = (idx: number, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) => {
      const updated = [...prev];
      const line = { ...updated[idx], [field]: value };
      line.amount = Number(line.quantity) * Number(line.unit_price);
      updated[idx] = line;
      return updated;
    });
  };

  const removeLine = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const subtotal = lineItems.reduce((s, l) => s + l.amount, 0);

  // Parse tax config from invoice
  const taxConfig = Array.isArray(invoice.tax_config) ? (invoice.tax_config as any[]) : [];
  const taxTotal = taxConfig.reduce((s, t) => s + (subtotal * (t.bps || 0)) / 10000, 0);
  const grandTotal = subtotal + taxTotal;

  const saveLineItems = async () => {
    if (!currentWorkspace) return;
    const mushakErr = validateMushak(mushak);
    if (mushakErr) {
      toast.error(mushakErr);
      return;
    }
    setSaving(true);
    try {
      // Delete existing and re-insert
      await supabase.from("invoice_line_items").delete().eq("invoice_id", invoice.id);

      if (lineItems.length > 0) {
        const { error } = await supabase.from("invoice_line_items").insert(
          lineItems.map((l, i) => ({
            invoice_id: invoice.id,
            workspace_id: currentWorkspace.id,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            amount: l.amount,
            sort_order: i,
          }))
        );
        if (error) throw error;
      }

      // Update invoice totals + Mushak metadata
      const { error: updateErr } = await supabase
        .from("invoices")
        .update({
          subtotal,
          tax_total: taxTotal,
          grand_total: grandTotal,
          mushak_6_3: buildMushakPayload(mushak),
        })
        .eq("id", invoice.id);
      if (updateErr) throw updateErr;

      toast.success("Invoice saved");
      onUpdated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const markIssued = async () => {
    if (!currentWorkspace) return;
    if (lineItems.length === 0) {
      toast.error("Add at least one line item before issuing");
      return;
    }
    const mushakErr = validateMushak(mushak);
    if (mushakErr) {
      toast.error(mushakErr);
      return;
    }
    // Preflight: BD Mushak 6.3 requires the workspace's own seller identity.
    // Read via admin-only RPC (sensitive doc_* fields are not on the client workspace row).
    if (mushak.enabled) {
      const { data: identRows } = await supabase
        .rpc("get_workspace_doc_identity" as any, { _workspace_id: currentWorkspace.id });
      const ident: any = Array.isArray(identRows) ? identRows[0] : identRows;
      const regName = (ident?.doc_registered_name || "").trim();
      const address = (ident?.doc_address || "").trim();
      const bin = (ident?.doc_bin || "").trim();
      if (!regName || !address || !BIN_REGEX.test(bin)) {
        toast.error(
          "Workspace seller identity (registered name, address, 13-char BIN) is required for Mushak 6.3. Set it in Settings → Workspace → Document Identity."
        );
        return;
      }
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("issue_invoice", {
        _workspace_id: currentWorkspace.id,
        _invoice_id: invoice.id,
        _line_items: lineItems.map((l, i) => ({
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          amount: l.amount,
          sort_order: i,
        })),
        _mushak_6_3: buildMushakPayload(mushak),
      } as any);
      if (error) throw error;
      const result = data as any;
      if (!result?.success) {
        toast.error(result?.error || "Failed to issue invoice");
        return;
      }
      toast.success("Invoice issued");
      onUpdated();
      onBack();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const voidInvoice = async () => {
    if (!currentWorkspace) return;
    const { data, error } = await supabase.rpc("void_invoice", {
      _workspace_id: currentWorkspace.id,
      _invoice_id: invoice.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data as any;
    if (!result?.success) {
      toast.error(result?.error || "Failed to void invoice");
      return;
    }
    toast.success("Invoice voided");
    onUpdated();
    onBack();
  };

  const mushakHasContent = Object.keys(buildMushakPayload(mushak)).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to invoices">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl font-semibold text-foreground">{invoice.invoice_number}</h2>
          <Badge className={STATUS_COLORS[invoice.status]}>{invoice.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const issuer = await resolveWorkspaceIssuer(currentWorkspace);
                await exportInvoicePdf({
                  invoiceId: invoice.id,
                  workspaceCurrency: currentWorkspace?.currency,
                  issuer,
                });
                toast.success("PDF downloaded");
              } catch (err: any) {
                toast.error(err.message || "PDF export failed");
              }
            }}
          >
            <Download className="mr-1 h-4 w-4" /> Download PDF
          </Button>
          {isDraft && (
            <>
              <Button variant="outline" onClick={saveLineItems} disabled={saving}>
                Save
              </Button>
              <Button onClick={markIssued} disabled={saving}>
                Issue Invoice
              </Button>
            </>
          )}
          {invoice.status !== "void" && currentRole === "admin" && (
            <Button variant="destructive" onClick={voidInvoice}>
              Void
            </Button>
          )}
        </div>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Line Items</CardTitle>
          {isDraft && (
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus className="mr-1 h-3 w-3" /> Add Item
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {lineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No line items yet.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 text-xs font-medium text-muted-foreground">
                <span>Description</span><span>Qty</span><span>Unit Price</span><span>Amount</span><span />
              </div>
              {lineItems.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 items-center">
                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(idx, "description", e.target.value)}
                    disabled={!isDraft}
                    placeholder="Service description"
                    className="h-8 text-sm"
                  />
                  <Input
                    type="number"
                    value={line.quantity}
                    onChange={(e) => updateLine(idx, "quantity", Number(e.target.value))}
                    disabled={!isDraft}
                    className="h-8 text-sm"
                    min={0}
                  />
                  <Input
                    type="number"
                    value={line.unit_price}
                    onChange={(e) => updateLine(idx, "unit_price", Number(e.target.value))}
                    disabled={!isDraft}
                    className="h-8 text-sm"
                    min={0}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {line.amount.toLocaleString("en-BD")}
                  </span>
                  {isDraft && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeLine(idx)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Totals */}
          <div className="mt-4 border-t pt-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium text-foreground">৳{subtotal.toLocaleString("en-BD")}</span>
            </div>
            {taxConfig.map((t: any, i: number) => (
              <div key={i} className="flex justify-between">
                <span className="text-muted-foreground">{t.label || "Tax"} ({(t.bps / 100).toFixed(1)}%)</span>
                <span className="text-foreground">৳{((subtotal * t.bps) / 10000).toLocaleString("en-BD")}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold text-base pt-1 border-t">
              <span>Grand Total</span>
              <span className="text-primary">৳{grandTotal.toLocaleString("en-BD")}</span>
            </div>
            {Number(invoice.amount_paid) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Paid</span>
                <span>৳{Number(invoice.amount_paid).toLocaleString("en-BD")}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Mushak 6.3 — VAT Challan (Bangladesh) */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Mushak 6.3 (VAT Challan)</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Bangladesh VAT compliance fields. Required only when issuing a tax challan.
              </p>
            </div>
            {isDraft ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="mushak-enabled"
                  checked={mushak.enabled}
                  onCheckedChange={(v) => updateMushak("enabled", v)}
                />
                <Label htmlFor="mushak-enabled" className="text-sm">
                  Applicable
                </Label>
              </div>
            ) : mushakHasContent ? (
              <Badge variant="outline">Tax invoice</Badge>
            ) : null}
          </div>
        </CardHeader>
        {(isDraft && mushak.enabled) || (!isDraft && mushakHasContent) ? (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mushak-vat-reg">
                  VAT Registration No (BIN) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="mushak-vat-reg"
                  value={mushak.vat_reg_no}
                  onChange={(e) => updateMushak("vat_reg_no", e.target.value)}
                  placeholder="13-digit BIN"
                  maxLength={13}
                  disabled={!isDraft}
                />
                <p className="text-xs text-muted-foreground">
                  Must be exactly 13 alphanumeric characters.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mushak-challan">
                  Challan No <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="mushak-challan"
                  value={mushak.challan_no}
                  onChange={(e) => updateMushak("challan_no", e.target.value)}
                  placeholder="e.g. CH-2025-001"
                  maxLength={64}
                  disabled={!isDraft}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mushak-hs">HS Code</Label>
                <Input
                  id="mushak-hs"
                  value={mushak.hs_code}
                  onChange={(e) => updateMushak("hs_code", e.target.value)}
                  placeholder="Optional"
                  maxLength={32}
                  disabled={!isDraft}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="mushak-buyer-address">Buyer address</Label>
                <Textarea
                  id="mushak-buyer-address"
                  value={mushak.buyer_address}
                  onChange={(e) => updateMushak("buyer_address", e.target.value)}
                  placeholder="Buyer registered address (optional)"
                  rows={2}
                  maxLength={500}
                  disabled={!isDraft}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="mushak-notes">Mushak notes</Label>
                <Textarea
                  id="mushak-notes"
                  value={mushak.notes}
                  onChange={(e) => updateMushak("notes", e.target.value)}
                  placeholder="Optional remarks for the challan"
                  rows={2}
                  maxLength={1000}
                  disabled={!isDraft}
                />
              </div>
            </div>
            {isDraft && (
              <p className="text-xs text-muted-foreground">
                Click <strong>Save</strong> to persist Mushak data, or <strong>Issue Invoice</strong> to lock it in.
              </p>
            )}
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
