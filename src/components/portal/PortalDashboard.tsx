import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortalProposals } from "./PortalProposals";
import { PortalInvoices } from "./PortalInvoices";
import { PortalPayments } from "./PortalPayments";
import { PortalUpdates } from "./PortalUpdates";
import { PortalDocuments } from "./PortalDocuments";
import { PortalOnboarding } from "./PortalOnboarding";
import {
  Building2, FileText, Receipt, CreditCard, LogOut, MessageSquare,
  FolderOpen, AlertCircle, Clock, CheckCircle2, ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { portalLogout, portalGetResource, type PortalSessionInfo } from "@/lib/portal-api";

interface Props {
  session: PortalSessionInfo;
}

interface PortalSummary {
  proposals_awaiting: number;
  unpaid_invoices: number;
  overdue_invoices: number;
  total_outstanding: number;
  currency: string;
  recent_updates: number;
  recent_update_date: string | null;
  onboarding_pending: number;
  onboarding_total: number;
}

export function PortalDashboard({ session }: Props) {
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  const fetchSummary = useCallback(async () => {
    const { data } = await portalGetResource<PortalSummary>("summary");
    if (data) setSummary(data);
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const handleLogout = async () => {
    await portalLogout();
    window.location.href = "/portal";
  };

  const hasActions = summary && (summary.proposals_awaiting > 0 || summary.overdue_invoices > 0 || summary.unpaid_invoices > 0);

  return (
    <main className="min-h-screen bg-muted/30">
      {/* Header */}
      <div className="border-b bg-card shadow-sm">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 sm:px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground truncate">{session.company_name}</h1>
              <p className="text-xs text-muted-foreground truncate">
                {session.contact_name} · {session.contact_email}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="shrink-0 text-muted-foreground hover:text-foreground">
            <LogOut className="mr-1 h-4 w-4" /> Sign Out
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview" className="gap-1.5">
              Overview
            </TabsTrigger>
            <TabsTrigger value="proposals" className="gap-1.5">
              <FileText className="h-4 w-4" /> Proposals
              {summary && summary.proposals_awaiting > 0 && (
                <Badge className="ml-1 h-5 bg-primary text-primary-foreground text-[10px] px-1.5">
                  {summary.proposals_awaiting}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="invoices" className="gap-1.5">
              <Receipt className="h-4 w-4" /> Invoices
              {summary && summary.unpaid_invoices > 0 && (
                <Badge className="ml-1 h-5 bg-amber-500 text-white text-[10px] px-1.5">
                  {summary.unpaid_invoices}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5">
              <CreditCard className="h-4 w-4" /> Payments
            </TabsTrigger>
            <TabsTrigger value="updates" className="gap-1.5">
              <MessageSquare className="h-4 w-4" /> Updates
            </TabsTrigger>
             <TabsTrigger value="documents" className="gap-1.5">
              <FolderOpen className="h-4 w-4" /> Documents
            </TabsTrigger>
            <TabsTrigger value="onboarding" className="gap-1.5">
              <ClipboardList className="h-4 w-4" /> Onboarding
              {summary && summary.onboarding_pending > 0 && (
                <Badge className="ml-1 h-5 bg-primary text-primary-foreground text-[10px] px-1.5">
                  {summary.onboarding_pending}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="space-y-6">
              {/* Welcome */}
              <div>
                <h2 className="text-xl font-semibold text-foreground">Welcome back, {session.contact_name.split(" ")[0]}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Here's an overview of your account with {session.company_name}.
                </p>
              </div>

              {/* Action items */}
              {hasActions && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="py-4">
                    <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3">
                      <AlertCircle className="h-4 w-4 text-primary" />
                      Items needing your attention
                    </h3>
                    <div className="space-y-2">
                      {summary!.proposals_awaiting > 0 && (
                        <button
                          onClick={() => setActiveTab("proposals")}
                          className="flex items-center gap-3 w-full text-left rounded-md border bg-card px-4 py-3 hover:border-primary/50 hover:shadow-sm transition-all group"
                        >
                          <FileText className="h-5 w-5 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                              {summary!.proposals_awaiting} proposal{summary!.proposals_awaiting > 1 ? "s" : ""} awaiting your decision
                            </p>
                            <p className="text-xs text-muted-foreground">Review and approve or decline</p>
                          </div>
                          <Badge className="bg-primary text-primary-foreground shrink-0">Review</Badge>
                        </button>
                      )}
                      {summary!.overdue_invoices > 0 && (
                        <button
                          onClick={() => setActiveTab("invoices")}
                          className="flex items-center gap-3 w-full text-left rounded-md border border-destructive/30 bg-card px-4 py-3 hover:border-destructive/50 hover:shadow-sm transition-all group"
                        >
                          <Clock className="h-5 w-5 text-destructive shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {summary!.overdue_invoices} overdue invoice{summary!.overdue_invoices > 1 ? "s" : ""}
                            </p>
                            <p className="text-xs text-muted-foreground">Payment is past the due date</p>
                          </div>
                          <Badge variant="destructive" className="shrink-0">Overdue</Badge>
                        </button>
                      )}
                      {summary!.unpaid_invoices > 0 && summary!.overdue_invoices === 0 && (
                        <button
                          onClick={() => setActiveTab("invoices")}
                          className="flex items-center gap-3 w-full text-left rounded-md border bg-card px-4 py-3 hover:border-primary/50 hover:shadow-sm transition-all group"
                        >
                          <Receipt className="h-5 w-5 text-amber-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {summary!.unpaid_invoices} unpaid invoice{summary!.unpaid_invoices > 1 ? "s" : ""}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Outstanding balance: {summary!.currency} {summary!.total_outstanding.toLocaleString()}
                            </p>
                          </div>
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Summary cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryCard
                  icon={<FileText className="h-5 w-5 text-blue-500" />}
                  label="Proposals"
                  value={summary?.proposals_awaiting ?? 0}
                  subtitle="awaiting decision"
                  onClick={() => setActiveTab("proposals")}
                />
                <SummaryCard
                  icon={<Receipt className="h-5 w-5 text-amber-500" />}
                  label="Invoices"
                  value={summary?.unpaid_invoices ?? 0}
                  subtitle="unpaid"
                  onClick={() => setActiveTab("invoices")}
                />
                <SummaryCard
                  icon={<MessageSquare className="h-5 w-5 text-emerald-500" />}
                  label="Updates"
                  value={summary?.recent_updates ?? 0}
                  subtitle="recent"
                  onClick={() => setActiveTab("updates")}
                />
                <SummaryCard
                  icon={<CreditCard className="h-5 w-5 text-violet-500" />}
                  label="Outstanding"
                  value={summary ? `${summary.currency} ${summary.total_outstanding.toLocaleString()}` : "—"}
                  subtitle="balance due"
                  onClick={() => setActiveTab("invoices")}
                />
              </div>

              {/* All clear state */}
              {summary && !hasActions && (
                <Card>
                  <CardContent className="py-8 text-center">
                    <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500/60 mb-3" />
                    <h3 className="text-sm font-medium text-foreground mb-1">You're all caught up</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      There are no items requiring your immediate attention. Use the tabs above to browse your proposals, invoices, and documents.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="proposals">
            <PortalProposals session={session} />
          </TabsContent>
          <TabsContent value="invoices">
            <PortalInvoices session={session} />
          </TabsContent>
          <TabsContent value="payments">
            <PortalPayments session={session} />
          </TabsContent>
          <TabsContent value="updates">
            <PortalUpdates session={session} />
          </TabsContent>
          <TabsContent value="documents">
            <PortalDocuments session={session} />
          </TabsContent>
          <TabsContent value="onboarding">
            <PortalOnboarding session={session} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border bg-card p-4 text-left hover:border-primary/40 hover:shadow-sm transition-all group"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
          {label}
        </span>
        {icon}
      </div>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
    </button>
  );
}
