import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Download, Plus, Trash2 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { exportInvoicePdf } from "@/lib/invoice-pdf";
import { toast } from "sonner";

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
  const isDraft = invoice.status === "draft";

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

      // Update invoice totals
      const { error: updateErr } = await supabase
        .from("invoices")
        .update({ subtotal, tax_total: taxTotal, grand_total: grandTotal })
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
    if (lineItems.length === 0) {
      toast.error("Add at least one line item before issuing");
      return;
    }
    await saveLineItems();
    const { error } = await supabase
      .from("invoices")
      .update({ status: "issued" as any, issue_date: new Date().toISOString().split("T")[0] })
      .eq("id", invoice.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Invoice issued");
      onUpdated();
      onBack();
    }
  };

  const voidInvoice = async () => {
    const { error } = await supabase
      .from("invoices")
      .update({ status: "void" as any })
      .eq("id", invoice.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Invoice voided");
      onUpdated();
      onBack();
    }
  };

  // Mushak 6.3 breakdown display
  const mushak = invoice.mushak_6_3 as any;
  const hasMushak = mushak && Object.keys(mushak).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl font-semibold text-foreground">{invoice.invoice_number}</h2>
          <Badge className={STATUS_COLORS[invoice.status]}>{invoice.status}</Badge>
        </div>
        <div className="flex gap-2">
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

      {/* Mushak 6.3 Breakdown */}
      {hasMushak && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mushak 6.3 Tax Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted rounded p-3 overflow-auto">
              {JSON.stringify(mushak, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
