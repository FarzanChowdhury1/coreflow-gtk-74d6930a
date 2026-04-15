import { useState, useMemo } from "react";
import { CreditCard, Plus, Pause, Play, Pencil, Download, AlertTriangle } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { guardedExportToCSV } from "@/lib/guarded-export";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";
import { SubscriptionFormDialog } from "@/components/subscriptions/SubscriptionFormDialog";

export interface Subscription {
  id: string;
  workspace_id: string;
  name: string;
  vendor_id: string | null;
  amount: number;
  currency: string;
  interval_months: number;
  next_billing_date: string;
  category: string | null;
  is_active: boolean;
  notes: string | null;
  vendors?: { name: string } | null;
}

export const SUB_CATEGORIES = ["software", "hosting", "marketing", "communication", "insurance", "professional_services", "other"];

function formatCurrency(value: number, currency: string = "BDT") {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

export default function Subscriptions() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const queryClient = useQueryClient();
  const isAdmin = currentRole === "admin";
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [search, setSearch] = useState("");
  const currency = currentWorkspace?.currency || "BDT";

  const { data: subs = [], isLoading, isError: subsError } = useQuery({
    queryKey: ["subscriptions", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*, vendors(name)")
        .eq("workspace_id", currentWorkspace!.id)
        .order("next_billing_date");
      if (error) throw error;
      return data as Subscription[];
    },
  });

  const filtered = useMemo(() => {
    if (!search) return subs;
    const s = search.toLowerCase();
    return subs.filter((sub) => sub.name.toLowerCase().includes(s) || sub.vendors?.name?.toLowerCase().includes(s) || sub.category?.toLowerCase().includes(s));
  }, [subs, search]);

  const activeSubs = filtered.filter((s) => s.is_active);
  const monthlyBurn = activeSubs.reduce((sum, s) => sum + Number(s.amount) / s.interval_months, 0);

  const toggleActive = async (sub: Subscription) => {
    const { error } = await supabase.from("subscriptions").update({ is_active: !sub.is_active, updated_at: new Date().toISOString() }).eq("id", sub.id);
    if (error) { toast.error("Failed"); return; }
    toast.success(sub.is_active ? "Subscription paused" : "Subscription activated");
    queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
  };

  const handleExport = () => {
    if (!workspaceId) return;
    guardedExportToCSV(workspaceId, filtered.map((s) => ({ ...s, vendor_name: s.vendors?.name || "" })), [
      { key: "name", label: "Subscription" },
      { key: "vendor_name", label: "Vendor" },
      { key: "amount", label: "Amount" },
      { key: "currency", label: "Currency" },
      { key: "interval_months", label: "Interval (months)" },
      { key: "next_billing_date", label: "Next Billing" },
      { key: "category", label: "Category" },
      { key: "is_active", label: "Active" },
    ], "subscriptions");
  };

  if (!isAdmin) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-3">
          <CreditCard className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Subscriptions</h1>
        </div>
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Subscription management is available to workspace admins only.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Subscriptions</h1>
        <PageInfoButton
          title="Subscriptions"
          description="Track recurring business costs — software, services, and operational subscriptions. Similar to renewals but for money going out."
          actions={["Track recurring outgoing costs", "Link to vendors for supplier tracking", "Pause/resume subscriptions"]}
          audience="Admins managing recurring business expenses."
        />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Recurring business costs — software, services, and operational subscriptions.</p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input placeholder="Search subscriptions…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Add Subscription
        </Button>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="mr-1 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {activeSubs.length > 0 && (
        <div className="mb-3 flex gap-4 text-sm">
          <span className="text-muted-foreground">{activeSubs.length} active</span>
          <span className="text-muted-foreground">Monthly burn: <span className="font-medium text-foreground">{formatCurrency(Math.round(monthlyBurn), currency)}</span></span>
        </div>
      )}

      {subsError && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground">Failed to load subscriptions. Try refreshing the page.</p>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <CreditCard className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h2 className="text-sm font-medium text-foreground mb-1">
            {search ? "No subscriptions match" : "No subscriptions yet"}
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {search
              ? "Try adjusting your search term."
              : "Subscriptions help you track recurring tools, software, and service costs. Add subscriptions here so monthly and yearly commitments stay visible."}
          </p>
          {!search && (
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add First Subscription
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subscription</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead>Next Billing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((sub) => (
                <TableRow key={sub.id} className={!sub.is_active ? "opacity-50" : ""}>
                  <TableCell className="font-medium">{sub.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{sub.vendors?.name || "—"}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{sub.category || "other"}</Badge></TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(Number(sub.amount), sub.currency)}</TableCell>
                  <TableCell className="text-xs">{sub.interval_months === 1 ? "Monthly" : sub.interval_months === 12 ? "Yearly" : `${sub.interval_months}mo`}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{format(new Date(sub.next_billing_date), "dd MMM yyyy")}</TableCell>
                  <TableCell>{sub.is_active ? <Badge className="text-[10px] bg-primary/10 text-primary">Active</Badge> : <Badge variant="outline" className="text-[10px]">Paused</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditing(sub); setFormOpen(true); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => toggleActive(sub)}>
                        {sub.is_active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {formOpen && (
        <SubscriptionFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          subscription={editing}
          workspaceId={currentWorkspace!.id}
          currency={currency}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ["subscriptions"] }); setFormOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
