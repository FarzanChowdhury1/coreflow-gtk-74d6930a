import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, CheckCircle2, Search } from "lucide-react";
import { format } from "date-fns";

type PaymentMethod = "bank_transfer" | "bkash_manual" | "cash" | "other";

interface WorkspaceLite {
  id: string;
  name: string;
  plan: string;
  billing_cycle: string | null;
  trial_ends_at: string | null;
  seat_count: number;
  seat_limit: number;
  billing_owner_email: string | null;
  deleted_at: string | null;
}

interface ActivationRow {
  id: string;
  workspace_id: string;
  plan: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  notes: string | null;
  activated_by: string;
  activated_at: string;
  previous_plan: string | null;
  previous_billing_cycle: string | null;
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  bkash_manual: "bKash (manual)",
  cash: "Cash",
  other: "Other",
};

export default function PlatformActivations() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceLite[]>([]);
  const [workspaceNames, setWorkspaceNames] = useState<Record<string, string>>({});
  const [activations, setActivations] = useState<ActivationRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");

  // form state
  const [plan, setPlan] = useState<string>("growth");
  const [billingCycle, setBillingCycle] = useState<string>("monthly");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("BDT");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [paymentReference, setPaymentReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: overview, error: overviewErr }, { data: acts, error: actsErr }] = await Promise.all([
      supabase.rpc("platform_workspace_overview" as any),
      supabase
        .from("paid_plan_activations" as any)
        .select("*")
        .order("activated_at", { ascending: false })
        .limit(100),
    ]);

    if (overviewErr) {
      toast({ title: "Failed to load workspaces", description: overviewErr.message, variant: "destructive" });
    } else {
      const rows = ((overview as any)?.workspaces ?? []) as any[];
      const lite: WorkspaceLite[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        plan: r.plan,
        billing_cycle: r.billing_cycle ?? null,
        trial_ends_at: r.trial_ends_at,
        seat_count: r.seat_count ?? 0,
        seat_limit: r.seat_limit ?? 0,
        billing_owner_email: r.billing_owner_email ?? null,
        deleted_at: r.deleted_at ?? null,
      }));
      setWorkspaces(lite);
      const map: Record<string, string> = {};
      lite.forEach((w) => { map[w.id] = w.name; });
      setWorkspaceNames(map);
    }

    if (actsErr) {
      toast({ title: "Failed to load activations", description: actsErr.message, variant: "destructive" });
    } else {
      setActivations((acts as any[]) ?? []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filteredWorkspaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = workspaces.filter((w) => !w.deleted_at);
    if (q) {
      rows = rows.filter((w) =>
        w.name.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q) ||
        (w.billing_owner_email ?? "").toLowerCase().includes(q),
      );
    }
    return rows.slice(0, 25);
  }, [workspaces, search]);

  const selected = useMemo(
    () => workspaces.find((w) => w.id === selectedId) || null,
    [workspaces, selectedId],
  );

  const handleSelect = (ws: WorkspaceLite) => {
    setSelectedId(ws.id);
    setPlan(ws.plan === "starter" ? "starter" : "growth");
    setBillingCycle(ws.billing_cycle === "annual" ? "annual" : "monthly");
    setAmount("");
    setPaymentReference("");
    setNotes("");
  };

  const resetForm = () => {
    setSelectedId("");
    setAmount("");
    setPaymentReference("");
    setNotes("");
  };

  const handleActivate = async () => {
    if (!selected) {
      toast({ title: "Select a workspace first", variant: "destructive" });
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      toast({ title: "Enter a valid amount (>= 0)", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.rpc("activate_paid_plan_with_log" as any, {
      _workspace_id: selected.id,
      _plan: plan,
      _billing_cycle: billingCycle,
      _amount: amt,
      _currency: currency || "BDT",
      _payment_method: paymentMethod,
      _payment_reference: paymentReference,
      _notes: notes,
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "Activation failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: "Plan activated",
      description: `${selected.name} is now on ${plan} (${billingCycle}). Logged.`,
    });
    resetForm();
    fetchAll();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1200px] px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to="/platform/dashboard">
            <Button variant="ghost" size="icon" aria-label="Back to platform dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Manual Plan Activation</h1>
            <p className="text-sm text-muted-foreground">
              Activate a paid plan after manual payment collection. Every activation is logged for revenue audit.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Workspace picker + current state */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">1. Select workspace</CardTitle>
              <CardDescription>Search by name, billing email, or workspace id.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search workspace..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="border rounded-md max-h-[280px] overflow-auto">
                {filteredWorkspaces.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground text-center">No matches.</p>
                ) : filteredWorkspaces.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => handleSelect(w)}
                    className={`w-full text-left px-3 py-2 border-b last:border-0 hover:bg-muted/50 transition-colors ${
                      selectedId === w.id ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{w.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {w.billing_owner_email ?? "No billing owner"}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{w.plan}</Badge>
                    </div>
                  </button>
                ))}
              </div>

              {selected && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                  <p className="text-sm font-medium">{selected.name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Plan: <strong className="text-foreground">{selected.plan}</strong></span>
                    <span>Cycle: <strong className="text-foreground">{selected.billing_cycle ?? "—"}</strong></span>
                    <span>Seats: <strong className="text-foreground">{selected.seat_count}/{selected.seat_limit}</strong></span>
                    {selected.trial_ends_at && (
                      <span>Trial ends: <strong className="text-foreground">{format(new Date(selected.trial_ends_at), "PP")}</strong></span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activation form */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">2. Record payment & activate</CardTitle>
              <CardDescription>Atomic: writes audit log + flips plan in one transaction.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Plan</Label>
                  <Select value={plan} onValueChange={setPlan}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="growth">Growth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Billing cycle</Label>
                  <Select value={billingCycle} onValueChange={setBillingCycle}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="annual">Annual (11× monthly)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label>Amount collected</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 5990"
                  />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={4} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Payment method</Label>
                  <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((k) => (
                        <SelectItem key={k} value={k}>{PAYMENT_METHOD_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Payment reference</Label>
                  <Input
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Txn ID / slip #"
                  />
                </div>
              </div>

              <div>
                <Label>Notes (optional)</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Context for revenue ops..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={resetForm} disabled={submitting}>Reset</Button>
                <Button onClick={handleActivate} disabled={submitting || !selected}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Activate plan
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* History */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Activation history ({activations.length})</CardTitle>
            <CardDescription>Most recent first. Last 100 activations.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Activated</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Plan → Cycle</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Previous</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activations.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                        No activations recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : activations.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(a.activated_at), "PP p")}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {workspaceNames[a.workspace_id] ?? <span className="text-muted-foreground">{a.workspace_id.slice(0, 8)}</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline">{a.plan}</Badge>
                        <span className="text-muted-foreground"> · {a.billing_cycle}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {a.currency} {Number(a.amount).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">{PAYMENT_METHOD_LABELS[a.payment_method] ?? a.payment_method}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {a.payment_reference ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.previous_plan ?? "—"} / {a.previous_billing_cycle ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
