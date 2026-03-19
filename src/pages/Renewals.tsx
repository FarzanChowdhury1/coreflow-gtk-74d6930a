import { useState, useMemo } from "react";
import { RefreshCw, Plus, Pause, Play, Receipt, FileText, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RenewalFormDialog } from "@/components/renewals/RenewalFormDialog";
import { format } from "date-fns";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface Renewal {
  id: string;
  workspace_id: string;
  company_id: string;
  project_id: string | null;
  invoice_id: string | null;
  last_generated_billing_date: string | null;
  label: string;
  amount: number;
  currency: string;
  interval_months: number;
  next_billing_date: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  companies?: { legal_name: string } | null;
  invoices?: { invoice_number: string; status: string } | null;
}

function urgencyBucket(nextDate: string): "overdue" | "within_7" | "within_30" | "future" {
  const d = new Date(nextDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "overdue";
  if (diff <= 7) return "within_7";
  if (diff <= 30) return "within_30";
  return "future";
}

const BUCKET_CONFIG = {
  overdue: { label: "Overdue", color: "bg-destructive/10 text-destructive border-destructive/30" },
  within_7: { label: "Within 7 Days", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-300 dark:border-amber-700" },
  within_30: { label: "Within 30 Days", color: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  future: { label: "Later", color: "bg-muted text-muted-foreground border-border" },
};

export default function Renewals() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Renewal | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const isAdmin = currentRole === "admin";

  const { data: renewals = [], isLoading } = useQuery({
    queryKey: ["renewals", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("renewals")
        .select("*, companies(legal_name), invoices(invoice_number, status)")
        .eq("workspace_id", currentWorkspace!.id)
        .order("next_billing_date", { ascending: true });
      if (error) throw error;
      return data as unknown as Renewal[];
    },
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, legal_name")
        .eq("workspace_id", currentWorkspace!.id)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-list", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .eq("workspace_id", currentWorkspace!.id)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  const grouped = useMemo(() => {
    const active = renewals.filter((r) => r.is_active);
    const inactive = renewals.filter((r) => !r.is_active);
    const buckets: Record<string, Renewal[]> = { overdue: [], within_7: [], within_30: [], future: [] };
    active.forEach((r) => {
      const b = urgencyBucket(r.next_billing_date);
      buckets[b].push(r);
    });
    return { buckets, inactive };
  }, [renewals]);

  const toggleActive = async (r: Renewal) => {
    if (!currentWorkspace) return;
    const { data, error } = await supabase.rpc("manage_renewal", {
      _action: "toggle_active",
      _workspace_id: currentWorkspace.id,
      _renewal_id: r.id,
    });
    const result = data as unknown as { success: boolean; error?: string };
    if (error || !result?.success) {
      toast.error(result?.error || error?.message || "Failed");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["renewals"] });
  };

  const generateInvoice = async (r: Renewal) => {
    if (!currentWorkspace) return;
    setGeneratingId(r.id);
    try {
      const { data, error } = await supabase.rpc("generate_renewal_invoice" as any, {
        _workspace_id: currentWorkspace.id,
        _renewal_id: r.id,
      });
      const result = data as any;
      if (error || !result?.success) {
        toast.error(result?.error || error?.message || "Failed to generate invoice");
        return;
      }
      toast.success(`Invoice ${result.invoice_number} generated`);
      queryClient.invalidateQueries({ queryKey: ["renewals"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    } finally {
      setGeneratingId(null);
    }
  };

  const canGenerateInvoice = (r: Renewal) => {
    if (!r.is_active || r.amount <= 0) return false;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const billingDate = new Date(r.next_billing_date);
    if (billingDate > now) return false;
    if (r.last_generated_billing_date == null) return true;
    return new Date(r.last_generated_billing_date) < billingDate;
  };

  const hasGeneratedInvoice = (r: Renewal) => {
    return r.last_generated_billing_date != null && r.invoice_id != null;
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Renewals</h1>
        </div>
        {isAdmin && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" /> New Renewal
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading…</div>
      ) : renewals.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          No renewals configured yet.
        </div>
      ) : (
        <div className="space-y-6">
          {(["overdue", "within_7", "within_30", "future"] as const).map((bucket) => {
            const items = grouped.buckets[bucket];
            if (items.length === 0) return null;
            const cfg = BUCKET_CONFIG[bucket];
            return (
              <div key={bucket}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-sm font-medium text-foreground">{cfg.label}</h2>
                  <Badge variant="secondary" className="text-xs">{items.length}</Badge>
                </div>
                <div className="space-y-2">
                  {items.map((r) => (
                    <div key={r.id} className={`flex items-center justify-between rounded-md border px-4 py-3 ${cfg.color}`}>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{r.label}</span>
                          <span className="text-xs opacity-70">{r.companies?.legal_name}</span>
                          {cycleAlreadyInvoiced(r) && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-green-700 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3" /> Cycle invoiced
                            </span>
                          )}
                          {canGenerateInvoice(r) && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400">
                              Ready to invoice
                            </span>
                          )}
                        </div>
                        <p className="text-xs opacity-80">
                          {r.currency} {Number(r.amount).toLocaleString()} · every {r.interval_months}mo · next {format(new Date(r.next_billing_date), "dd MMM yyyy")}
                          {r.invoice_id && r.invoices && (
                            <span className="inline-flex items-center gap-1 ml-2 opacity-90 cursor-pointer hover:underline" onClick={() => navigate("/invoices")}>
                              <Receipt className="h-3 w-3 inline" />
                              {r.invoices.invoice_number}
                              {r.invoices.status === "paid" && " ✓"}
                            </span>
                          )}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          {canGenerateInvoice(r) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => generateInvoice(r)}
                              disabled={generatingId === r.id}
                              title="Generate invoice for current cycle"
                            >
                              {generatingId === r.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <FileText className="h-3 w-3 mr-1" />
                              )}
                              {generatingId !== r.id && "Invoice"}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => toggleActive(r)} title="Pause">
                            <Pause className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setEditing(r); setFormOpen(true); }}>
                            Edit
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {grouped.inactive.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">Paused / Inactive</h2>
              <div className="space-y-2">
                {grouped.inactive.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-md border border-border px-4 py-3 opacity-60">
                    <div className="space-y-0.5">
                      <span className="font-medium text-sm text-foreground">{r.label}</span>
                      <p className="text-xs text-muted-foreground">
                        {r.companies?.legal_name} · {r.currency} {Number(r.amount).toLocaleString()}
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(r)} title="Reactivate">
                          <Play className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(r); setFormOpen(true); }}>
                          Edit
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <RenewalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        renewal={editing}
        companies={companies}
        projects={projects}
      />
    </div>
  );
}
