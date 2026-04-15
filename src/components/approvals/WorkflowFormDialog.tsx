import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import { Plus, Trash2, Info } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  members: { user_id: string; full_name: string | null }[];
}

const ENTITY_TYPES = [
  { value: "proposal_version", label: "Proposal", description: "Review proposals before sending to clients" },
  { value: "invoice", label: "Invoice", description: "Review invoices before issuing" },
  { value: "project", label: "Project", description: "Review new projects before starting" },
];

const workflowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  entity_type: z.enum(["proposal_version", "invoice", "project"]),
});

type WorkflowFormData = z.infer<typeof workflowSchema>;

export function WorkflowFormDialog({ open, onOpenChange, onCreated, members }: Props) {
  const { currentWorkspace } = useWorkspace();
  const [saving, setSaving] = useState(false);
  const [steps, setSteps] = useState<{ approver_id: string }[]>([{ approver_id: "" }]);

  const form = useForm<WorkflowFormData>({
    resolver: zodResolver(workflowSchema),
    defaultValues: { name: "", entity_type: "proposal_version" },
  });

  const addStep = () => setSteps((prev) => [...prev, { approver_id: "" }]);
  const removeStep = (idx: number) => setSteps((prev) => prev.filter((_, i) => i !== idx));
  const updateStep = (idx: number, approverId: string) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { approver_id: approverId } : s)));
  };

  const onSubmit = async (data: WorkflowFormData) => {
    if (!currentWorkspace) return;
    const validSteps = steps.filter((s) => s.approver_id);
    if (validSteps.length === 0) {
      toast.error("Add at least one reviewer");
      return;
    }
    setSaving(true);
    try {
      const { data: workflow, error } = await supabase
        .from("approval_workflows")
        .insert({
          workspace_id: currentWorkspace.id,
          name: data.name,
          entity_type: data.entity_type,
        })
        .select()
        .single();

      if (error) throw error;

      const { error: stepError } = await supabase.from("approval_steps").insert(
        validSteps.map((s, i) => ({
          workflow_id: workflow.id,
          workspace_id: currentWorkspace.id,
          step_order: i + 1,
          approver_id: s.approver_id,
        }))
      );
      if (stepError) throw stepError;

      toast.success("Workflow created");
      form.reset();
      setSteps([{ approver_id: "" }]);
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Review Workflow</DialogTitle>
          <DialogDescription>
            Set up a review chain for your team. Each reviewer will be asked to approve in order — the item moves forward only after all reviewers sign off.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workflow Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Proposal Sign-off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="entity_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What does this workflow review? *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ENTITY_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {ENTITY_TYPES.find((t) => t.value === field.value)?.description}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Reviewers (in order)</span>
                <Button type="button" size="sm" variant="outline" onClick={addStep}>
                  <Plus className="mr-1 h-3 w-3" /> Add Reviewer
                </Button>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Reviewer #1 is asked first. Once they approve, reviewer #2 is notified, and so on.
              </p>
              {steps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-6 shrink-0">#{idx + 1}</span>
                  <Select onValueChange={(v) => updateStep(idx, v)} value={step.approver_id}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select team member" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name || m.user_id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {steps.length > 1 && (
                    <Button type="button" size="icon" variant="ghost" onClick={() => removeStep(idx)} aria-label={`Remove approval step ${idx + 1}`}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create Workflow"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
