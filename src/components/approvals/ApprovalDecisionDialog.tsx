import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  onDecided: () => void;
}

export function ApprovalDecisionDialog({ open, onOpenChange, requestId, onDecided }: Props) {
  const [comment, setComment] = useState("");
  const [processing, setProcessing] = useState(false);

  const handleDecision = async (decision: "approved" | "rejected") => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc("process_approval_decision", {
        _request_id: requestId,
        _decision: decision,
        _comment: comment || null,
      });
      if (error) throw error;
      const result = data as any;
      if (!result.success) throw new Error(result.error);
      toast.success(decision === "approved" ? "Approved" : "Rejected");
      setComment("");
      onOpenChange(false);
      onDecided();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approval Decision</DialogTitle>
          <DialogDescription>Review and provide your decision for this approval request.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Comment (optional)</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note for the audit trail…"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={processing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => handleDecision("rejected")} disabled={processing}>
            Reject
          </Button>
          <Button onClick={() => handleDecision("approved")} disabled={processing}>
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
