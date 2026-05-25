import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource, portalAction } from "@/lib/portal-api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  ClipboardList, CheckCircle2, Clock, AlertTriangle, Send,
  ChevronDown, ChevronUp, ExternalLink, LinkIcon, FileText,
} from "lucide-react";
import { format } from "date-fns";
import { safeHttpUrl } from "@/lib/safe-url";

interface Props {
  session: PortalSessionInfo;
}

interface OnboardingTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  due_date: string | null;
  response_text: string | null;
  response_link: string | null;
  response_notes: string | null;
  revision_note: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  project_id: string | null;
  project_name: string | null;
}

const STATUS_META: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  todo: { label: "To Do", color: "bg-muted text-muted-foreground", icon: Clock },
  submitted: { label: "Submitted", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: ClipboardList },
  approved: { label: "Completed", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: CheckCircle2 },
  revision_requested: { label: "Revision Needed", color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200", icon: AlertTriangle },
};

export function PortalOnboarding({ session: _session }: Props) {
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [formText, setFormText] = useState("");
  const [formLink, setFormLink] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await portalGetResource<OnboardingTask[]>("onboarding_tasks");
    if (error) console.error(error);
    setTasks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const toggleExpand = (taskId: string) => {
    if (expandedId === taskId) {
      setExpandedId(null);
    } else {
      setExpandedId(taskId);
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        setFormText(task.response_text || "");
        setFormLink(task.response_link || "");
        setFormNotes(task.response_notes || "");
      }
    }
  };

  const handleSubmit = async (taskId: string) => {
    if (!formText.trim() && !formLink.trim()) {
      toast.error("Please provide a response or a link");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await portalAction("submit_onboarding_task", {
        task_id: taskId,
        response_text: formText.trim() || null,
        response_link: formLink.trim() || null,
        response_notes: formNotes.trim() || null,
      });
      if (error) throw new Error(error);
      toast.success("Submitted successfully!");
      setExpandedId(null);
      fetchTasks();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="text-center py-8 text-muted-foreground">Loading onboarding tasks…</p>;

  if (tasks.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-10 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="text-sm font-medium text-foreground mb-1">No onboarding tasks</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Your service provider hasn't assigned any onboarding tasks yet. When they do, you'll see them here with clear instructions on what to provide.
          </p>
        </CardContent>
      </Card>
    );
  }

  const completed = tasks.filter((t) => t.status === "approved").length;
  const total = tasks.length;
  const pending = tasks.filter((t) => t.status === "todo" || t.status === "revision_requested");
  const submitted = tasks.filter((t) => t.status === "submitted");
  const done = tasks.filter((t) => t.status === "approved");

  return (
    <div className="space-y-5 mt-4">
      {/* Progress header */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-foreground">Onboarding Progress</h3>
            <span className="text-sm font-medium text-muted-foreground">{completed}/{total}</span>
          </div>
          <Progress value={(completed / total) * 100} className="h-2" />
          {completed === total ? (
            <p className="text-xs text-primary mt-2 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> All tasks completed — you're all set!
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">
              {pending.length} item{pending.length !== 1 ? "s" : ""} need{pending.length === 1 ? "s" : ""} your attention
            </p>
          )}
        </CardContent>
      </Card>

      {/* Pending tasks */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            Action Required
          </h4>
          {pending.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              expanded={expandedId === task.id}
              onToggle={() => toggleExpand(task.id)}
              formText={formText}
              formLink={formLink}
              formNotes={formNotes}
              onFormTextChange={setFormText}
              onFormLinkChange={setFormLink}
              onFormNotesChange={setFormNotes}
              onSubmit={() => handleSubmit(task.id)}
              submitting={submitting}
              highlight
            />
          ))}
        </div>
      )}

      {/* Submitted / awaiting review */}
      {submitted.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Awaiting Review</h4>
          {submitted.map((task) => (
            <TaskCard key={task.id} task={task} expanded={false} onToggle={() => {}} submitting={false}
              formText="" formLink="" formNotes=""
              onFormTextChange={() => {}} onFormLinkChange={() => {}} onFormNotesChange={() => {}}
              onSubmit={() => {}}
            />
          ))}
        </div>
      )}

      {/* Completed */}
      {done.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Completed</h4>
          {done.map((task) => (
            <TaskCard key={task.id} task={task} expanded={false} onToggle={() => {}} submitting={false}
              formText="" formLink="" formNotes=""
              onFormTextChange={() => {}} onFormLinkChange={() => {}} onFormNotesChange={() => {}}
              onSubmit={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Submission content renderer ---- */
function SubmissionContent({ task }: { task: OnboardingTask }) {
  const hasText = !!task.response_text;
  const hasLink = !!task.response_link;
  const hasNotes = !!task.response_notes;

  if (!hasText && !hasLink && !hasNotes) return null;

  return (
    <div className="border-t px-4 py-3 space-y-2">
      {hasText && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
            <FileText className="h-3 w-3" /> Your Response
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{task.response_text}</p>
        </div>
      )}
      {hasLink && (() => {
        const safeLink = safeHttpUrl(task.response_link);
        return (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <LinkIcon className="h-3 w-3" /> Attached Link
            </p>
            {safeLink ? (
              <a href={safeLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline inline-flex items-center gap-1 break-all">
                <ExternalLink className="h-3 w-3 shrink-0" /> {safeLink}
              </a>
            ) : (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Submitted link is not a safe https:// URL.
              </p>
            )}
          </div>
        );
      })()}
      {hasNotes && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Additional Notes</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{task.response_notes}</p>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  expanded,
  onToggle,
  formText,
  formLink,
  formNotes,
  onFormTextChange,
  onFormLinkChange,
  onFormNotesChange,
  onSubmit,
  submitting,
  highlight,
}: {
  task: OnboardingTask;
  expanded: boolean;
  onToggle: () => void;
  formText: string;
  formLink: string;
  formNotes: string;
  onFormTextChange: (v: string) => void;
  onFormLinkChange: (v: string) => void;
  onFormNotesChange: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  highlight?: boolean;
}) {
  const meta = STATUS_META[task.status] || STATUS_META.todo;
  const StatusIcon = meta.icon;
  const canSubmit = task.status === "todo" || task.status === "revision_requested";

  return (
    <Card className={highlight ? "border-primary/30" : ""}>
      <div
        className={`flex items-center justify-between p-4 ${canSubmit ? "cursor-pointer hover:bg-muted/50" : ""} transition-colors`}
        onClick={canSubmit ? onToggle : undefined}
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <StatusIcon className={`h-5 w-5 shrink-0 mt-0.5 ${task.status === "approved" ? "text-primary" : task.status === "revision_requested" ? "text-amber-500" : "text-muted-foreground"}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">{task.title}</span>
              <Badge className={`text-[10px] h-5 ${meta.color}`}>{meta.label}</Badge>
              {task.project_name && (
                <Badge variant="outline" className="text-[10px] h-5 font-normal">
                  {task.project_name}
                </Badge>
              )}
            </div>
            {task.description && !expanded && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
            )}
            {task.due_date && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Due {format(new Date(task.due_date), "dd MMM yyyy")}
              </p>
            )}
          </div>
        </div>
        {canSubmit && (
          <span className="shrink-0 ml-2">
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </span>
        )}
      </div>

      {expanded && canSubmit && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3">
          {task.description && (
            <div className="rounded-md bg-muted/50 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Instructions</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {task.status === "revision_requested" && task.revision_note && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-1">Revision Requested</p>
              <p className="text-sm text-amber-900 dark:text-amber-100">{task.revision_note}</p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground">Your Response</label>
            <Textarea
              value={formText}
              onChange={(e) => onFormTextChange(e.target.value)}
              placeholder="Type your response here…"
              className="mt-1"
              rows={3}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground flex items-center gap-1">
              <ExternalLink className="h-3.5 w-3.5" /> Link (optional)
            </label>
            <Input
              type="url"
              inputMode="url"
              value={formLink}
              onChange={(e) => onFormLinkChange(e.target.value)}
              placeholder="https://drive.google.com/…"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">Use a full link starting with https://</p>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Additional Notes (optional)</label>
            <Textarea
              value={formNotes}
              onChange={(e) => onFormNotesChange(e.target.value)}
              placeholder="Anything else to mention…"
              className="mt-1"
              rows={2}
            />
          </div>

          <Button onClick={onSubmit} disabled={submitting || (!formText.trim() && !formLink.trim())} className="w-full gap-1.5">
            <Send className="h-4 w-4" /> Submit
          </Button>
        </div>
      )}

      {/* Show previous response for submitted/approved - using unified renderer */}
      {(task.status === "submitted" || task.status === "approved") && (
        <SubmissionContent task={task} />
      )}
    </Card>
  );
}
