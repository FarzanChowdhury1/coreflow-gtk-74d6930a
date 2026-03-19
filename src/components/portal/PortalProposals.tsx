import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource, portalAction } from "@/lib/portal-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Check, X, ChevronDown, ChevronUp, FileText, AlertCircle } from "lucide-react";
import { format } from "date-fns";

interface Props {
  session: PortalSessionInfo;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-destructive/10 text-destructive",
  voided: "bg-muted text-muted-foreground line-through",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Awaiting Your Decision",
  approved: "Approved",
  rejected: "Declined",
  voided: "Voided",
};

export function PortalProposals({ session: _session }: Props) {
  const [proposals, setProposals] = useState<any[]>([]);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    const { data, error } = await portalGetResource<any[]>("proposals");
    if (error) toast.error(error);
    setProposals(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  const toggleVersion = async (versionId: string) => {
    if (expandedVersion === versionId) {
      setExpandedVersion(null);
      return;
    }
    setExpandedVersion(versionId);

    if (!lineItems[versionId]) {
      const { data } = await portalAction<{ data: any[] }>("get_line_items", { version_id: versionId });
      if (data?.data) setLineItems((prev) => ({ ...prev, [versionId]: data.data }));
    }
  };

  const respond = async (versionId: string, decision: "approved" | "rejected") => {
    setResponding(true);
    try {
      const { error } = await portalAction("respond_proposal", { version_id: versionId, decision });
      if (error) throw new Error(error);
      toast.success(decision === "approved" ? "Proposal approved — thank you!" : "Proposal declined");
      fetchProposals();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setResponding(false);
    }
  };

  if (loading) return <p className="text-center py-8 text-muted-foreground">Loading proposals…</p>;

  if (proposals.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="text-sm font-medium text-foreground mb-1">No proposals yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            When your service provider sends you a proposal for review, it will appear here. You'll be able to view the details and approve or decline.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Separate proposals needing action vs others
  const needsAction = proposals.filter((p) =>
    (p.proposal_versions || []).some((v: any) => v.status === "sent")
  );
  const others = proposals.filter((p) =>
    !(p.proposal_versions || []).some((v: any) => v.status === "sent")
  );

  return (
    <div className="space-y-6 mt-4">
      {needsAction.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-primary" />
            Awaiting your decision
          </h3>
          {needsAction.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              expandedVersion={expandedVersion}
              lineItems={lineItems}
              responding={responding}
              onToggle={toggleVersion}
              onRespond={respond}
              highlight
            />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="space-y-3">
          {needsAction.length > 0 && (
            <h3 className="text-sm font-medium text-muted-foreground">Previous proposals</h3>
          )}
          {others.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              expandedVersion={expandedVersion}
              lineItems={lineItems}
              responding={responding}
              onToggle={toggleVersion}
              onRespond={respond}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  expandedVersion,
  lineItems,
  responding,
  onToggle,
  onRespond,
  highlight,
}: {
  proposal: any;
  expandedVersion: string | null;
  lineItems: Record<string, any[]>;
  responding: boolean;
  onToggle: (id: string) => void;
  onRespond: (id: string, decision: "approved" | "rejected") => void;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/40 shadow-sm" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{proposal.title}</CardTitle>
        {proposal.notes && (
          <p className="text-sm text-muted-foreground">{proposal.notes}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {(proposal.proposal_versions || [])
          .sort((a: any, b: any) => b.version_number - a.version_number)
          .map((v: any) => {
            const isSent = v.status === "sent";
            return (
              <div key={v.id} className={`border rounded-lg ${isSent ? "border-primary/30 bg-primary/5" : ""}`}>
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => onToggle(v.id)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">Version {v.version_number}</span>
                    <Badge className={STATUS_COLORS[v.status]}>
                      {STATUS_LABELS[v.status] || v.status}
                    </Badge>
                    <span className="text-sm text-muted-foreground font-mono">
                      {v.currency || "BDT"} {Number(v.grand_total).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {v.valid_until && (
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        Valid until {format(new Date(v.valid_until), "dd MMM yyyy")}
                      </span>
                    )}
                    {expandedVersion === v.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {expandedVersion === v.id && (
                  <div className="border-t p-4 space-y-4">
                    {lineItems[v.id] && lineItems[v.id].length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[400px]">
                          <thead>
                            <tr className="text-xs text-muted-foreground border-b">
                              <th className="text-left pb-2 font-medium">Description</th>
                              <th className="text-right pb-2 font-medium w-16">Qty</th>
                              <th className="text-right pb-2 font-medium w-24">Unit Price</th>
                              <th className="text-right pb-2 font-medium w-24">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lineItems[v.id].map((li: any) => (
                              <tr key={li.id} className="border-b last:border-0">
                                <td className="py-2 text-foreground">{li.description}</td>
                                <td className="py-2 text-right">{Number(li.quantity)}</td>
                                <td className="py-2 text-right">{Number(li.unit_price).toLocaleString()}</td>
                                <td className="py-2 text-right font-medium">{Number(li.amount).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No line items available.</p>
                    )}

                    <div className="border-t pt-3 text-sm space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span>{Number(v.subtotal).toLocaleString()}</span>
                      </div>
                      {Number(v.tax_total) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Tax</span>
                          <span>{Number(v.tax_total).toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold text-foreground pt-1 border-t">
                        <span>Total</span>
                        <span className="text-primary">
                          {v.currency || "BDT"} {Number(v.grand_total).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {v.notes && (
                      <div className="border-t pt-3">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                        <p className="text-sm text-foreground">{v.notes}</p>
                      </div>
                    )}

                    {isSent && (
                      <div className="border-t pt-4">
                        <p className="text-xs text-muted-foreground mb-3">
                          Please review the details above and let us know your decision.
                        </p>
                        <div className="flex gap-2">
                          <Button onClick={() => onRespond(v.id, "approved")} disabled={responding} className="gap-1.5">
                            <Check className="h-4 w-4" /> Approve Proposal
                          </Button>
                          <Button variant="outline" onClick={() => onRespond(v.id, "rejected")} disabled={responding} className="gap-1.5 text-destructive hover:text-destructive">
                            <X className="h-4 w-4" /> Decline
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}
