import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Info, Loader2, UserCheck } from "lucide-react";

interface AdminEntry {
  user_id: string;
  email: string;
  full_name: string | null;
}

export function BillingOwnerSection() {
  const { currentWorkspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [billingOwnerId, setBillingOwnerId] = useState<string | null>(null);
  const [billingOwnerEmail, setBillingOwnerEmail] = useState<string | null>(null);
  const [billingOwnerName, setBillingOwnerName] = useState<string | null>(null);
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchBillingOwner = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_billing_owner" as any, {
      _workspace_id: currentWorkspace.id,
    });
    if (!error && data) {
      const d = data as any;
      setBillingOwnerId(d.billing_owner_id ?? null);
      setBillingOwnerEmail(d.billing_owner_email ?? null);
      setBillingOwnerName(d.billing_owner_name ?? null);
      setAdmins(d.admins ?? []);
      setSelectedId(d.billing_owner_id ?? null);
    }
    setLoading(false);
  }, [currentWorkspace?.id]);

  useEffect(() => { fetchBillingOwner(); }, [fetchBillingOwner]);

  const handleSave = async () => {
    if (!currentWorkspace || !selectedId || selectedId === billingOwnerId) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("set_billing_owner" as any, {
      _workspace_id: currentWorkspace.id,
      _new_owner_id: selectedId,
    });
    setSaving(false);
    if (error) {
      toast.error("Failed to update billing owner.");
      return;
    }
    toast.success("Billing owner updated.");
    fetchBillingOwner();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const displayName = billingOwnerName || billingOwnerEmail || "Not set";
  const hasMultipleAdmins = admins.length > 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck className="h-5 w-5 text-primary" />
          Billing Owner
        </CardTitle>
        <CardDescription>
          The primary commercial contact for this workspace. CoreFlow will reach out to this person for billing, subscription, and account matters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm shrink-0">
            {(billingOwnerName || billingOwnerEmail || "?")[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{displayName}</p>
            {billingOwnerName && billingOwnerEmail && (
              <p className="text-xs text-muted-foreground">{billingOwnerEmail}</p>
            )}
          </div>
        </div>

        {hasMultipleAdmins && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Change billing owner</label>
            <div className="flex gap-2">
              <Select value={selectedId ?? ""} onValueChange={setSelectedId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select admin" />
                </SelectTrigger>
                <SelectContent>
                  {admins.map((a) => (
                    <SelectItem key={a.user_id} value={a.user_id}>
                      {a.full_name ? `${a.full_name} (${a.email})` : a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !selectedId || selectedId === billingOwnerId}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            All workspace admins can view plan and billing information. The billing owner is the primary contact for commercial discussions and subscription management.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
