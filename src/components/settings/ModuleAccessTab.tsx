import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Store, CreditCard } from "lucide-react";
import { toast } from "sonner";

type Module = "vendor_management" | "subscription_management";

interface MemberRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: "admin" | "team_member";
  vendor: boolean;
  subscription: boolean;
}

const MODULE_META: Record<Module, { label: string; icon: typeof Store; description: string }> = {
  vendor_management: {
    label: "Vendor Management",
    icon: Store,
    description: "Add, edit, and archive vendors.",
  },
  subscription_management: {
    label: "Subscription Management",
    icon: CreditCard,
    description: "View, add, edit, pause, and archive subscriptions.",
  },
};

export function ModuleAccessTab() {
  const { currentWorkspace } = useWorkspace();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);

    const [{ data: memberships }, { data: grants }] = await Promise.all([
      supabase
        .from("workspace_memberships")
        .select("user_id, role")
        .eq("workspace_id", currentWorkspace.id),
      supabase
        .from("workspace_module_access")
        .select("user_id, module")
        .eq("workspace_id", currentWorkspace.id),
    ]);

    const userIds = (memberships ?? []).map((m) => m.user_id);
    const profilesRes = userIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
    const profileMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));

    const rows: MemberRow[] = (memberships ?? [])
      .filter((m) => m.role === "team_member") // admins always have access
      .map((m) => {
        const p = profileMap.get(m.user_id);
        const userGrants = (grants ?? []).filter((g) => g.user_id === m.user_id);
        return {
          user_id: m.user_id,
          full_name: p?.full_name ?? null,
          email: p?.email ?? null,
          role: m.role as "team_member",
          vendor: userGrants.some((g) => g.module === "vendor_management"),
          subscription: userGrants.some((g) => g.module === "subscription_management"),
        };
      })
      .sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""));

    setMembers(rows);
    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggle = async (userId: string, module: Module, next: boolean) => {
    if (!currentWorkspace) return;
    const key = `${userId}:${module}`;
    setBusyKey(key);
    if (next) {
      const { error } = await supabase.from("workspace_module_access").insert({
        workspace_id: currentWorkspace.id,
        user_id: userId,
        module,
      });
      if (error) {
        toast.error("Failed to grant access");
        setBusyKey(null);
        return;
      }
      toast.success("Access granted");
    } else {
      const { error } = await supabase
        .from("workspace_module_access")
        .delete()
        .eq("workspace_id", currentWorkspace.id)
        .eq("user_id", userId)
        .eq("module", module);
      if (error) {
        toast.error("Failed to revoke access");
        setBusyKey(null);
        return;
      }
      toast.success("Access revoked");
    }
    setMembers((prev) =>
      prev.map((m) =>
        m.user_id === userId
          ? { ...m, [module === "vendor_management" ? "vendor" : "subscription"]: next }
          : m,
      ),
    );
    setBusyKey(null);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Module Access</CardTitle>
          <CardDescription>
            Grant specific team members permission to manage Vendors and Subscriptions.
            Admins always have access — they don't appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No team members yet. Invite team members from the Internal Team page first.
            </p>
          ) : (
            <div className="space-y-2">
              {/* Header */}
              <div className="hidden md:grid grid-cols-[1fr_140px_140px] gap-3 px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b">
                <span>Member</span>
                <span className="text-center">Vendors</span>
                <span className="text-center">Subscriptions</span>
              </div>
              {members.map((m) => {
                const vKey = `${m.user_id}:vendor_management`;
                const sKey = `${m.user_id}:subscription_management`;
                return (
                  <div
                    key={m.user_id}
                    className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px] gap-3 items-center rounded-md border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {m.full_name || m.email || "Unknown user"}
                      </p>
                      {m.full_name && m.email && (
                        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                      )}
                    </div>
                    <div className="flex md:justify-center items-center gap-2">
                      <Switch
                        checked={m.vendor}
                        disabled={busyKey === vKey}
                        onCheckedChange={(v) => toggle(m.user_id, "vendor_management", v)}
                        aria-label="Vendor management access"
                      />
                      <span className="md:hidden text-xs text-muted-foreground">Vendors</span>
                    </div>
                    <div className="flex md:justify-center items-center gap-2">
                      <Switch
                        checked={m.subscription}
                        disabled={busyKey === sKey}
                        onCheckedChange={(v) => toggle(m.user_id, "subscription_management", v)}
                        aria-label="Subscription management access"
                      />
                      <span className="md:hidden text-xs text-muted-foreground">Subscriptions</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About module access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          {(Object.keys(MODULE_META) as Module[]).map((m) => {
            const meta = MODULE_META[m];
            const Icon = meta.icon;
            return (
              <div key={m} className="flex items-start gap-3">
                <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-foreground font-medium flex items-center gap-2">
                    {meta.label}
                    <Badge variant="outline" className="text-[10px]">Admins always</Badge>
                  </p>
                  <p>{meta.description}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
