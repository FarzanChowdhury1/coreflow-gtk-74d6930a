import { useState } from "react";
import { FileText, Plus, Search, Download } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { exportToCSV } from "@/lib/csv-export";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { ProposalFormDialog } from "@/components/proposals/ProposalFormDialog";
import { ProposalDetail } from "@/components/proposals/ProposalDetail";

export default function Proposals() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const workspaceId = currentWorkspace?.id;
  const isAdmin = currentRole === "admin";

  const { data: proposals = [], isLoading } = useQuery({
    queryKey: ["proposals", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("proposals")
        .select("*, companies(legal_name)")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 30000,
  });

  const { data: latestVersions = [] } = useQuery({
    queryKey: ["proposal_versions_latest", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("proposal_versions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 30000,
  });

  const getLatestVersion = (proposalId: string) =>
    latestVersions.find((v) => v.proposal_id === proposalId);

  const filtered = proposals.filter((p) =>
    p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.companies as any)?.legal_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const statusColors: Record<string, string> = {
    draft: "bg-muted text-foreground/70",
    sent: "bg-secondary text-secondary-foreground",
    approved: "bg-success/15 text-success",
    rejected: "bg-destructive/15 text-destructive",
    voided: "bg-muted text-foreground/70 line-through",
  };

  // RLS handles scoping — non-admins see only owned/relevant proposals

  if (selectedProposalId) {
    return (
      <ProposalDetail
        proposalId={selectedProposalId}
        onBack={() => setSelectedProposalId(null)}
      />
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Proposal Builder</h1>
          <PageInfoButton
            title="Proposals"
            description="Create, version, and track commercial proposals for clients. Each proposal can have multiple versions with line items and pricing."
            actions={["Create proposals for client companies", "Track version status (draft, sent, approved, rejected)", "Export proposals as PDFs"]}
            audience="Sales and admin teams preparing client bids."
            note="Non-admin members see only proposals they own or are linked to."
          />
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                exportToCSV(
                  proposals.map((p: any) => ({
                    title: p.title,
                    company: p.companies?.legal_name || "",
                    status: getLatestVersion(p.id)?.status || "draft",
                    grand_total: getLatestVersion(p.id)?.grand_total || 0,
                    created: new Date(p.created_at).toLocaleDateString(),
                  })),
                  [
                    { key: "title", label: "Proposal Title" },
                    { key: "company", label: "Company" },
                    { key: "status", label: "Latest Status" },
                    { key: "grand_total", label: "Total" },
                    { key: "created", label: "Created" },
                  ],
                  "proposals-export"
                )
              }
            >
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Proposal
            </Button>
          </div>
        )}
      </div>
      <p className="mb-5 text-sm text-muted-foreground max-w-2xl">
        {isAdmin
          ? "Create proposals with line items and pricing, send them for client approval, then convert approved proposals into projects."
          : "Proposals linked to your projects or assigned to you appear here."}
      </p>

      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search proposals..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-5 flex-1" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h2 className="text-sm font-medium text-foreground mb-1">No proposals yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Proposals let you send pricing and scope to clients for approval. Create one, add line items, then send it for sign-off.
          </p>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create First Proposal
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[650px]">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Company</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Version</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Grand Total</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((proposal) => {
                const version = getLatestVersion(proposal.id);
                return (
                  <tr
                    key={proposal.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedProposalId(proposal.id)}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{proposal.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {(proposal.companies as any)?.legal_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {version ? `v${version.version_number}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {version ? (
                        <Badge variant="secondary" className={statusColors[version.status] || ""}>
                          {version.status}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {version ? `${version.currency} ${Number(version.grand_total).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm">View</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProposalFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
