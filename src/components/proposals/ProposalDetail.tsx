import { useState } from "react";
import { ArrowLeft, Plus, Send, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportProposalPdf } from "@/lib/proposal-pdf";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { LineItemEditor } from "./LineItemEditor";

interface Props {
  proposalId: string;
  onBack: () => void;
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-secondary text-secondary-foreground",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  voided: "bg-muted text-muted-foreground line-through",
};

export function ProposalDetail({ proposalId, onBack }: Props) {
  const { currentWorkspace, currentRole } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const workspaceId = currentWorkspace?.id;
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data: proposal } = useQuery({
    queryKey: ["proposal", proposalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("*, companies(legal_name, bin)")
        .eq("id", proposalId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: versions = [] } = useQuery({
    queryKey: ["proposal_versions", proposalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposal_versions")
        .select("*")
        .eq("proposal_id", proposalId)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const activeVersion = selectedVersionId
    ? versions.find((v) => v.id === selectedVersionId)
    : versions[0];

  const isDraft = activeVersion?.status === "draft";

  const handleMarkSent = async () => {
    if (!activeVersion) return;
    const { error } = await supabase
      .from("proposal_versions")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", activeVersion.id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Version marked as sent — now immutable" });
      queryClient.invalidateQueries({ queryKey: ["proposal_versions", proposalId] });
      queryClient.invalidateQueries({ queryKey: ["proposal_versions_latest"] });
    }
  };

  const handleNewVersion = async () => {
    if (!workspaceId || !activeVersion) return;
    const nextNumber = Math.max(...versions.map((v) => v.version_number)) + 1;

    // Create new version
    const { data: newVersion, error } = await supabase
      .from("proposal_versions")
      .insert({
        workspace_id: workspaceId,
        proposal_id: proposalId,
        version_number: nextNumber,
        status: "draft",
        tax_config: activeVersion.tax_config,
        currency: activeVersion.currency,
      })
      .select()
      .single();

    if (error || !newVersion) {
      toast({ title: "Failed", description: error?.message, variant: "destructive" });
      return;
    }

    // Copy line items from current version to new version
    const { data: lineItems } = await supabase
      .from("proposal_line_items")
      .select("*")
      .eq("version_id", activeVersion.id);

    if (lineItems && lineItems.length > 0) {
      const copies = lineItems.map((li) => ({
        workspace_id: workspaceId,
        version_id: newVersion.id,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        amount: li.amount,
        sort_order: li.sort_order,
      }));
      await supabase.from("proposal_line_items").insert(copies);
    }

    toast({ title: `Version ${nextNumber} created as draft` });
    setSelectedVersionId(newVersion.id);
    queryClient.invalidateQueries({ queryKey: ["proposal_versions", proposalId] });
    queryClient.invalidateQueries({ queryKey: ["proposal_versions_latest"] });
  };

  const handleVoidVersion = async () => {
    if (!activeVersion || currentRole !== "admin") return;
    const { error } = await supabase
      .from("proposal_versions")
      .update({ status: "voided" })
      .eq("id", activeVersion.id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Version voided" });
      queryClient.invalidateQueries({ queryKey: ["proposal_versions", proposalId] });
      queryClient.invalidateQueries({ queryKey: ["proposal_versions_latest"] });
    }
  };

  const handleExportPdf = async () => {
    if (!activeVersion || !currentWorkspace) return;
    setExporting(true);
    try {
      await exportProposalPdf({
        proposalId,
        versionId: activeVersion.id,
        workspaceName: currentWorkspace.name,
        workspaceCurrency: currentWorkspace.currency,
      });
      toast({ title: "PDF downloaded" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (!proposal) return <div className="text-center py-8 text-muted-foreground">Loading...</div>;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Proposals
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{proposal.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {(proposal.companies as any)?.legal_name} · BIN: {(proposal.companies as any)?.bin}
            </p>
          </div>
          <div className="flex gap-2">
            {isDraft && (
              <Button size="sm" onClick={handleMarkSent}>
                <Send className="h-4 w-4 mr-1" /> Mark as Sent
              </Button>
            )}
            {!isDraft && activeVersion?.status !== "voided" && (
              <Button size="sm" variant="outline" onClick={handleNewVersion}>
                <Copy className="h-4 w-4 mr-1" /> New Version
              </Button>
            )}
            {!isDraft && activeVersion?.status !== "voided" && currentRole === "admin" && (
              <Button size="sm" variant="destructive" onClick={handleVoidVersion}>
                Void
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Version tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelectedVersionId(v.id)}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              (activeVersion?.id === v.id)
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            v{v.version_number}
            <Badge variant="secondary" className={`text-xs ${statusColors[v.status] || ""}`}>
              {v.status}
            </Badge>
          </button>
        ))}
      </div>

      {/* Line items editor */}
      {activeVersion && (
        <LineItemEditor
          version={activeVersion}
          proposalId={proposalId}
          isLocked={!isDraft}
        />
      )}
    </div>
  );
}
