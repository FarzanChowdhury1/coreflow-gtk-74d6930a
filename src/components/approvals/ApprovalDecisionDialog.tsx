import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Info } from "lucide-react";

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
        _comment: comment || undefined,
      });
      if (error) throw error;
      const result = data as any;
      if (!result.success) throw new Error(result.error);
      toast.success(
        decision === "approved"
          ? "Approved — moving to next step"
          : "Declined — submitter will be notified"
      );
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
          <DialogTitle>Review This Item</DialogTitle>
          <DialogDescription>
            Approve to move it forward, or decline to send it back. Add a note so everyone knows why.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Note for the team (recommended)</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Looks good, approved. / Needs changes to pricing section."
              rows={3}
            />
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Your note is recorded permanently for reference.
            </p>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={processing}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => handleDecision("rejected")}
            disabled={processing}
            className="gap-1.5"
          >
            <XCircle className="h-4 w-4" />
            Decline
          </Button>
          <Button
            onClick={() => handleDecision("approved")}
            disabled={processing}
            className="gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
