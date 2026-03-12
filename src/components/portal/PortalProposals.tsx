import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource, portalAction } from "@/lib/portal-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Check, X, ChevronDown, ChevronUp } from "lucide-react";
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

export function PortalProposals({ session }: Props) {
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
      const { data, error } = await portalAction("respond_proposal", { version_id: versionId, decision });
      if (error) throw new Error(error);
      toast.success(`Proposal ${decision}`);
      fetchProposals();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setResponding(false);
    }
  };

  if (loading) return <p className="text-center py-8 text-muted-foreground">Loading proposals…</p>;
  if (proposals.length === 0) return <p className="text-center py-8 text-muted-foreground">No proposals found.</p>;

  return (
    <div className="space-y-4 mt-4">
      {proposals.map((proposal) => (
        <Card key={proposal.id}>
          <CardHeader>
            <CardTitle className="text-base">{proposal.title}</CardTitle>
            {proposal.notes && (
              <p className="text-sm text-muted-foreground">{proposal.notes}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {(proposal.proposal_versions || [])
              .sort((a: any, b: any) => b.version_number - a.version_number)
              .map((v: any) => (
                <div key={v.id} className="border rounded-lg">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleVersion(v.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">v{v.version_number}</span>
                      <Badge className={STATUS_COLORS[v.status]}>{v.status}</Badge>
                      <span className="text-sm text-muted-foreground">
                        ৳{Number(v.grand_total).toLocaleString("en-BD")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {v.valid_until && (
                        <span className="text-xs text-muted-foreground">
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
                    <div className="border-t p-3 space-y-3">
                      {lineItems[v.id] && lineItems[v.id].length > 0 ? (
                        <div className="space-y-1">
                          <div className="grid grid-cols-[1fr_60px_80px_80px] gap-2 text-xs font-medium text-muted-foreground">
                            <span>Description</span><span>Qty</span><span>Unit Price</span><span>Amount</span>
                          </div>
                          {lineItems[v.id].map((li: any) => (
                            <div key={li.id} className="grid grid-cols-[1fr_60px_80px_80px] gap-2 text-sm">
                              <span className="text-foreground">{li.description}</span>
                              <span>{Number(li.quantity)}</span>
                              <span>৳{Number(li.unit_price).toLocaleString("en-BD")}</span>
                              <span className="font-medium">৳{Number(li.amount).toLocaleString("en-BD")}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No line items.</p>
                      )}

                      <div className="border-t pt-2 text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span>৳{Number(v.subtotal).toLocaleString("en-BD")}</span>
                        </div>
                        {Number(v.tax_total) > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Tax</span>
                            <span>৳{Number(v.tax_total).toLocaleString("en-BD")}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-semibold text-foreground">
                          <span>Grand Total</span>
                          <span className="text-primary">৳{Number(v.grand_total).toLocaleString("en-BD")}</span>
                        </div>
                      </div>

                      {v.notes && (
                        <p className="text-xs text-muted-foreground border-t pt-2">{v.notes}</p>
                      )}

                      {v.status === "sent" && (
                        <div className="flex gap-2 border-t pt-3">
                          <Button size="sm" onClick={() => respond(v.id, "approved")} disabled={responding} className="gap-1">
                            <Check className="h-3 w-3" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => respond(v.id, "rejected")} disabled={responding} className="gap-1">
                            <X className="h-3 w-3" /> Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
