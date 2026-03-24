import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useLocation } from "react-router-dom";

const CATEGORIES = [
  { value: "bug", label: "Bug Report" },
  { value: "ui_ux", label: "UI / UX" },
  { value: "feature_request", label: "Feature Request" },
  { value: "performance", label: "Performance" },
  { value: "other", label: "Other" },
] as const;

const PRIORITIES = [
  { value: "p0", label: "P0 — Blocker", description: "Data loss, security, or workflow blocked" },
  { value: "p1", label: "P1 — Serious", description: "Serious friction, workaround exists" },
  { value: "p2", label: "P2 — Polish", description: "Confusion, cosmetic, or minor" },
] as const;

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("bug");
  const [priority, setPriority] = useState<string>("p2");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentWorkspace, currentRole } = useWorkspace();
  const location = useLocation();

  const handleSubmit = async () => {
    if (!title.trim() || !user || !currentWorkspace) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.from("beta_feedback" as any).insert({
        workspace_id: currentWorkspace.id,
        submitted_by: user.id,
        category,
        priority,
        title: title.trim(),
        description: description.trim() || null,
        current_route: location.pathname,
        submitter_role: currentRole || "unknown",
      } as any);

      if (error) throw error;

      toast({ title: "Feedback submitted", description: "Thank you for your input!" });
      setTitle("");
      setDescription("");
      setCategory("bug");
      setPriority("p2");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label="Submit beta feedback"
        >
          <MessageSquarePlus className="h-4 w-4" />
          <span className="hidden sm:inline">Beta Feedback</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Submit Beta Feedback</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="fb-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="fb-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb-priority">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="fb-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {PRIORITIES.find((p) => p.value === priority)?.description}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb-title">Title</Label>
            <Input
              id="fb-title"
              placeholder="Brief summary"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb-desc">Description (optional)</Label>
            <Textarea
              id="fb-desc"
              placeholder="Steps to reproduce, details, suggestions..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={2000}
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="w-full"
          >
            {submitting ? "Submitting…" : "Submit Feedback"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
