import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

type Category =
  | "daily_digest"
  | "approval_request"
  | "invoice_overdue"
  | "lead_followup"
  | "renewal_upcoming"
  | "system_alert";

interface Pref {
  category: Category;
  in_app_enabled: boolean;
  email_enabled: boolean;
}

const CATEGORIES: { value: Category; label: string; description: string }[] = [
  { value: "daily_digest", label: "Daily Digest", description: "Summary of overdue invoices, follow-ups, and upcoming renewals" },
  { value: "approval_request", label: "Approval Requests", description: "When an invoice or project needs your approval" },
  { value: "invoice_overdue", label: "Overdue Invoices", description: "Alerts when invoices pass their due date" },
  { value: "lead_followup", label: "Lead Follow-ups", description: "Reminders for scheduled lead follow-up dates" },
  { value: "renewal_upcoming", label: "Upcoming Renewals", description: "Alerts before contract renewals are due" },
  { value: "system_alert", label: "System Alerts", description: "Worker failures, cleanup results, and platform notices" },
];

const DEFAULT_PREFS: Pref[] = CATEGORIES.map((c) => ({
  category: c.value,
  in_app_enabled: true,
  email_enabled: true,
}));

export function NotificationPreferencesTab() {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const [prefs, setPrefs] = useState<Pref[]>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    if (!user || !currentWorkspace) return;
    const { data } = await supabase
      .from("notification_preferences")
      .select("category, in_app_enabled, email_enabled")
      .eq("user_id", user.id)
      .eq("workspace_id", currentWorkspace.id);

    // Merge saved prefs with defaults (categories not yet saved default to all-on)
    const saved = new Map((data || []).map((d: any) => [d.category, d]));
    setPrefs(
      CATEGORIES.map((c) => {
        const s = saved.get(c.value);
        return s
          ? { category: c.value, in_app_enabled: s.in_app_enabled, email_enabled: s.email_enabled }
          : { category: c.value, in_app_enabled: true, email_enabled: true };
      })
    );
    setLoading(false);
  }, [user, currentWorkspace]);

  useEffect(() => { fetchPrefs(); }, [fetchPrefs]);

  const togglePref = async (category: Category, field: "in_app_enabled" | "email_enabled", value: boolean) => {
    if (!user || !currentWorkspace) return;
    setSaving(category + field);

    // Optimistic update
    setPrefs((prev) =>
      prev.map((p) => (p.category === category ? { ...p, [field]: value } : p))
    );

    const { error } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          user_id: user.id,
          workspace_id: currentWorkspace.id,
          category,
          [field]: value,
          // Include the other field's current value to avoid overwriting
          ...(field === "in_app_enabled"
            ? { email_enabled: prefs.find((p) => p.category === category)?.email_enabled ?? true }
            : { in_app_enabled: prefs.find((p) => p.category === category)?.in_app_enabled ?? true }),
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "user_id,workspace_id,category" }
      );

    setSaving(null);

    if (error) {
      // Revert optimistic update
      setPrefs((prev) =>
        prev.map((p) => (p.category === category ? { ...p, [field]: !value } : p))
      );
      toast.error("Failed to update preference");
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>In-App Notifications</CardTitle>
          <CardDescription>Control which notifications appear in your notification center</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {CATEGORIES.map((cat) => {
            const pref = prefs.find((p) => p.category === cat.value)!;
            return (
              <div key={cat.value} className="flex items-center justify-between gap-4 py-2">
                <div className="space-y-0.5 min-w-0">
                  <Label className="text-sm font-medium">{cat.label}</Label>
                  <p className="text-xs text-muted-foreground">{cat.description}</p>
                </div>
                <Switch
                  checked={pref.in_app_enabled}
                  onCheckedChange={(v) => togglePref(cat.value, "in_app_enabled", v)}
                  disabled={saving === cat.value + "in_app_enabled"}
                  aria-label={`Toggle in-app notifications for ${cat.label}`}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

    </div>
  );
}
