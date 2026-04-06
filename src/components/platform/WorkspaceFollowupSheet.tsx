import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, Calendar, User, MessageSquare } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const STAGES = [
  "new", "trialing", "activated_free", "expansion_opportunity",
  "trial_expired", "follow_up_needed", "converted_manual",
  "enterprise_pipeline", "churn_risk", "inactive", "closed_lost",
] as const;

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  trialing: "Trialing",
  activated_free: "Activated (Free)",
  expansion_opportunity: "Expansion Opportunity",
  trial_expired: "Trial Expired",
  follow_up_needed: "Follow-up Needed",
  converted_manual: "Converted (Manual)",
  enterprise_pipeline: "Enterprise Pipeline",
  churn_risk: "Churn Risk",
  inactive: "Inactive",
  closed_lost: "Closed / Lost",
};

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

interface WorkspaceData {
  id: string;
  name: string;
  plan: string;
  seat_count: number;
  seat_limit: number;
  trial_ends_at: string | null;
  created_at: string;
  last_activity: string | null;
  event_count: number;
  admin_emails: string[] | null;
  billing_owner_email: string | null;
  followup_stage: string | null;
  next_followup_date: string | null;
  last_contacted_at: string | null;
  followup_priority: string | null;
  followup_owner_email: string | null;
  last_note: string | null;
  note_count: number;
}

interface NoteRow {
  id: string;
  note: string;
  created_at: string;
  author_email?: string;
}

interface Props {
  workspace: WorkspaceData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

export function WorkspaceFollowupSheet({ workspace, open, onOpenChange, onUpdated }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNote, setNewNote] = useState("");

  // Form state
  const [stage, setStage] = useState("new");
  const [priority, setPriority] = useState("normal");
  const [nextDate, setNextDate] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");

  // Load followup data when workspace changes
  useEffect(() => {
    if (!workspace || !open) return;
    setStage(workspace.followup_stage || "new");
    setPriority(workspace.followup_priority || "normal");
    setNextDate(workspace.next_followup_date || "");
    setOwnerEmail(workspace.followup_owner_email || "");
    loadNotes();
  }, [workspace?.id, open]);

  const loadNotes = useCallback(async () => {
    if (!workspace) return;
    setLoadingNotes(true);

    // Get the followup id for this workspace
    const { data: fu } = await supabase
      .from("workspace_followups" as any)
      .select("id")
      .eq("workspace_id", workspace.id)
      .maybeSingle();

    if (!fu) {
      setNotes([]);
      setLoadingNotes(false);
      return;
    }

    const { data: noteRows } = await supabase
      .from("workspace_followup_notes" as any)
      .select("id, note, created_at, author_id")
      .eq("followup_id", (fu as any).id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (noteRows && (noteRows as any[]).length > 0) {
      // Enrich with author emails
      const authorIds = [...new Set((noteRows as any[]).map((n: any) => n.author_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", authorIds);
      const nameMap = new Map((profiles || []).map((p) => [p.user_id, p.full_name || "Unknown"]));

      setNotes((noteRows as any[]).map((n: any) => ({
        id: n.id,
        note: n.note,
        created_at: n.created_at,
        author_email: nameMap.get(n.author_id) || "Platform Admin",
      })));
    } else {
      setNotes([]);
    }
    setLoadingNotes(false);
  }, [workspace?.id]);

  const ensureFollowup = async (): Promise<string | null> => {
    if (!workspace) return null;
    const { data: existing } = await supabase
      .from("workspace_followups" as any)
      .select("id")
      .eq("workspace_id", workspace.id)
      .maybeSingle();

    if (existing) return (existing as any).id;

    const { data: created, error } = await supabase
      .from("workspace_followups" as any)
      .insert({ workspace_id: workspace.id, stage: "new" } as any)
      .select("id")
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return null;
    }
    return (created as any).id;
  };

  const saveFollowup = async () => {
    if (!workspace) return;
    setSaving(true);

    const updates: Record<string, any> = {
      stage,
      priority,
      next_followup_date: nextDate || null,
      updated_at: new Date().toISOString(),
    };

    // Set owner_id if we can resolve it (for now, set to current user if "me")
    if (ownerEmail === "me" || ownerEmail === user?.email) {
      updates.owner_id = user?.id;
    }

    const { error } = await supabase
      .from("workspace_followups" as any)
      .update(updates as any)
      .eq("workspace_id", workspace.id);

    if (error) {
      toast({ title: "Error saving", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Follow-up updated" });
      onUpdated();
    }
    setSaving(false);
  };

  const addNote = async () => {
    if (!newNote.trim() || !workspace || !user) return;
    setSaving(true);

    const followupId = await ensureFollowup();
    if (!followupId) { setSaving(false); return; }

    const { error } = await supabase
      .from("workspace_followup_notes" as any)
      .insert({
        followup_id: followupId,
        author_id: user.id,
        note: newNote.trim(),
      } as any);

    if (error) {
      toast({ title: "Error adding note", description: error.message, variant: "destructive" });
    } else {
      setNewNote("");
      // Also update last_contacted_at
      await supabase
        .from("workspace_followups" as any)
        .update({ last_contacted_at: new Date().toISOString(), updated_at: new Date().toISOString() } as any)
        .eq("workspace_id", workspace.id);
      loadNotes();
      onUpdated();
    }
    setSaving(false);
  };

  const assignToMe = async () => {
    if (!workspace || !user) return;
    setSaving(true);
    const { error } = await supabase
      .from("workspace_followups" as any)
      .update({ owner_id: user.id, updated_at: new Date().toISOString() } as any)
      .eq("workspace_id", workspace.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setOwnerEmail(user.email || "");
      toast({ title: "Assigned to you" });
      onUpdated();
    }
    setSaving(false);
  };

  if (!workspace) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-lg">{workspace.name}</SheetTitle>
          <p className="text-sm text-muted-foreground">Internal follow-up — not visible to workspace users</p>
        </SheetHeader>

        <div className="space-y-5 py-4">
          {/* Workspace snapshot */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Plan:</span>
              <br />
              <Badge variant="outline" className="mt-0.5">{workspace.plan}</Badge>
              {workspace.trial_ends_at && (
                <span className="text-xs text-muted-foreground ml-1">
                  Trial {new Date(workspace.trial_ends_at) > new Date()
                    ? `ends ${format(new Date(workspace.trial_ends_at), "dd MMM")}`
                    : "expired"}
                </span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Seats:</span>
              <br />{workspace.seat_count}/{workspace.seat_limit}
            </div>
            <div>
              <span className="text-muted-foreground">Billing owner:</span>
              <br /><span className="text-xs">{workspace.billing_owner_email || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Last activity:</span>
              <br /><span className="text-xs">
                {workspace.last_activity
                  ? formatDistanceToNow(new Date(workspace.last_activity), { addSuffix: true })
                  : "None"}
              </span>
            </div>
          </div>

          <Separator />

          {/* Follow-up controls */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <User className="h-4 w-4" /> Internal Follow-up
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Commercial Stage</Label>
                <Select value={stage} onValueChange={setStage}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map(s => (
                      <SelectItem key={s} value={s} className="text-xs">
                        {STAGE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => (
                      <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Next Follow-up Date
              </Label>
              <Input
                type="date"
                value={nextDate}
                onChange={e => setNextDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Internal Owner</Label>
              <div className="flex gap-2">
                <Input
                  value={ownerEmail}
                  readOnly
                  placeholder="Unassigned"
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={assignToMe}
                  disabled={saving}
                >
                  Assign to me
                </Button>
              </div>
            </div>

            <Button size="sm" onClick={saveFollowup} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save Follow-up
            </Button>
          </div>

          <Separator />

          {/* Notes */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Internal Notes ({notes.length})
            </h3>

            <div className="flex gap-2">
              <Textarea
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Add internal note..."
                rows={2}
                className="text-sm flex-1"
              />
              <Button
                size="icon"
                variant="outline"
                className="h-auto self-end"
                onClick={addNote}
                disabled={saving || !newNote.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>

            {loadingNotes ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : notes.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">No notes yet.</p>
            ) : (
              <ScrollArea className="max-h-64">
                <div className="space-y-2">
                  {notes.map(n => (
                    <div key={n.id} className="rounded-md border p-2.5 text-sm">
                      <p className="whitespace-pre-wrap">{n.note}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {n.author_email} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
