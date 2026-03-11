import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Tables, Json } from "@/integrations/supabase/types";

type ProposalVersion = Tables<"proposal_versions">;
type LineItem = Tables<"proposal_line_items">;

interface TaxEntry {
  name: string;
  rate_bps: number; // basis points (1500 = 15%)
}

interface Props {
  version: ProposalVersion;
  proposalId: string;
  isLocked: boolean;
}

export function LineItemEditor({ version, proposalId, isLocked }: Props) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const workspaceId = currentWorkspace?.id;

  const { data: lineItems = [], isLoading } = useQuery({
    queryKey: ["proposal_line_items", version.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposal_line_items")
        .select("*")
        .eq("version_id", version.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const taxConfig: TaxEntry[] = Array.isArray(version.tax_config)
    ? (version.tax_config as any[]).map((t: any) => ({
        name: t.name || "Tax",
        rate_bps: Number(t.rate_bps) || 0,
      }))
    : [];

  // Calculations
  const subtotal = lineItems.reduce((sum, li) => sum + Number(li.amount), 0);
  const taxBreakdown = taxConfig.map((tax) => ({
    ...tax,
    amount: subtotal * (tax.rate_bps / 10000),
  }));
  const taxTotal = taxBreakdown.reduce((sum, t) => sum + t.amount, 0);
  const grandTotal = subtotal + taxTotal;

  // Sync totals to version when line items change
  const syncTotals = useCallback(async () => {
    if (isLocked) return;
    await supabase
      .from("proposal_versions")
      .update({
        subtotal: Number(subtotal.toFixed(2)),
        tax_total: Number(taxTotal.toFixed(2)),
        grand_total: Number(grandTotal.toFixed(2)),
      })
      .eq("id", version.id);
    queryClient.invalidateQueries({ queryKey: ["proposal_versions", proposalId] });
    queryClient.invalidateQueries({ queryKey: ["proposal_versions_latest"] });
  }, [subtotal, taxTotal, grandTotal, isLocked, version.id]);

  useEffect(() => {
    if (lineItems.length > 0) syncTotals();
  }, [subtotal, taxTotal, lineItems.length]);

  const handleAddLine = async () => {
    if (!workspaceId) return;
    const { error } = await supabase.from("proposal_line_items").insert({
      workspace_id: workspaceId,
      version_id: version.id,
      description: "New item",
      quantity: 1,
      unit_price: 0,
      amount: 0,
      sort_order: lineItems.length,
    });
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["proposal_line_items", version.id] });
    }
  };

  const handleUpdateLine = async (id: string, field: string, value: string | number) => {
    const item = lineItems.find((li) => li.id === id);
    if (!item) return;

    const updates: any = { [field]: value };

    // Auto-calculate amount
    if (field === "quantity" || field === "unit_price") {
      const qty = field === "quantity" ? Number(value) : Number(item.quantity);
      const price = field === "unit_price" ? Number(value) : Number(item.unit_price);
      updates.amount = (qty * price).toFixed(2);
    }

    const { error } = await supabase
      .from("proposal_line_items")
      .update(updates)
      .eq("id", id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["proposal_line_items", version.id] });
    }
  };

  const handleDeleteLine = async (id: string) => {
    const { error } = await supabase
      .from("proposal_line_items")
      .delete()
      .eq("id", id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["proposal_line_items", version.id] });
    }
  };

  const handleUpdateTaxConfig = async (index: number, field: string, value: string | number) => {
    const updated = [...taxConfig];
    (updated[index] as any)[field] = field === "rate_bps" ? Number(value) : value;
    await supabase
      .from("proposal_versions")
      .update({ tax_config: updated as unknown as Json })
      .eq("id", version.id);
    queryClient.invalidateQueries({ queryKey: ["proposal_versions", proposalId] });
  };

  return (
    <div className="space-y-6">
      {/* Line Items */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-foreground">Line Items</h3>
          {!isLocked && (
            <Button size="sm" variant="outline" onClick={handleAddLine}>
              <Plus className="h-4 w-4 mr-1" /> Add Item
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
        ) : lineItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No line items yet. Add items to build the proposal.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground w-[40%]">Description</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground w-[15%]">Qty</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground w-[20%]">Unit Price</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground w-[20%]">Amount</th>
                {!isLocked && <th className="px-4 py-2 w-[5%]" />}
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    {isLocked ? (
                      <span className="text-foreground">{item.description}</span>
                    ) : (
                      <input
                        type="text"
                        defaultValue={item.description}
                        onBlur={(e) => handleUpdateLine(item.id, "description", e.target.value)}
                        className="h-8 w-full rounded border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isLocked ? (
                      <span className="block text-right text-foreground">{Number(item.quantity)}</span>
                    ) : (
                      <input
                        type="number"
                        defaultValue={Number(item.quantity)}
                        min={0}
                        step="0.01"
                        onBlur={(e) => handleUpdateLine(item.id, "quantity", e.target.value)}
                        className="h-8 w-full rounded border bg-background px-2 text-right text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isLocked ? (
                      <span className="block text-right font-mono text-foreground">
                        {Number(item.unit_price).toLocaleString()}
                      </span>
                    ) : (
                      <input
                        type="number"
                        defaultValue={Number(item.unit_price)}
                        min={0}
                        step="0.01"
                        onBlur={(e) => handleUpdateLine(item.id, "unit_price", e.target.value)}
                        className="h-8 w-full rounded border bg-background px-2 text-right text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">
                    {Number(item.amount).toLocaleString()}
                  </td>
                  {!isLocked && (
                    <td className="px-4 py-2">
                      <button
                        onClick={() => handleDeleteLine(item.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Totals & Tax */}
      <div className="rounded-lg border bg-card p-4">
        <div className="space-y-2 max-w-sm ml-auto">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-mono text-foreground">{version.currency} {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>

          {/* Tax entries */}
          {taxConfig.map((tax, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {isLocked ? (
                  <span className="text-muted-foreground">{tax.name} ({(tax.rate_bps / 100).toFixed(1)}%)</span>
                ) : (
                  <>
                    <input
                      type="text"
                      defaultValue={tax.name}
                      onBlur={(e) => handleUpdateTaxConfig(i, "name", e.target.value)}
                      className="h-7 w-20 rounded border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      type="number"
                      defaultValue={tax.rate_bps}
                      onBlur={(e) => handleUpdateTaxConfig(i, "rate_bps", e.target.value)}
                      className="h-7 w-20 rounded border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      min={0}
                      step={1}
                    />
                    <span className="text-xs text-muted-foreground">bps</span>
                  </>
                )}
              </div>
              <span className="font-mono text-foreground">
                {version.currency} {taxBreakdown[i]?.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          ))}

          <div className="flex justify-between border-t pt-2 text-sm font-semibold">
            <span className="text-foreground">Grand Total</span>
            <span className="font-mono text-foreground">{version.currency} {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {isLocked && (
        <div className="rounded-md border border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
          🔒 This version is <strong>{version.status}</strong> and immutable. Line items and pricing cannot be modified.
          {version.status !== "voided" && " You can create a new version to make changes."}
        </div>
      )}
    </div>
  );
}
