import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { resolveEntitlement, type WorkspaceEntitlement } from "@/lib/entitlements";

/**
 * Effective seat count = active memberships + pending (non-expired) invites.
 * Mirrors `workspace_effective_seat_count` in the database so UI warnings,
 * promotion thresholds, and backend enforcement all agree.
 */
export function useEntitlement(): WorkspaceEntitlement {
  const { currentWorkspace, memberships } = useWorkspace();
  const [pendingInviteCount, setPendingInviteCount] = useState(0);

  useEffect(() => {
    if (!currentWorkspace?.id) {
      setPendingInviteCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("workspace_invites")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", currentWorkspace.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString());
      if (!cancelled) setPendingInviteCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentWorkspace?.id]);

  return useMemo(() => {
    const ws = currentWorkspace as any;
    const activeMembers = memberships.filter(
      (m) => m.workspace_id === currentWorkspace?.id
    ).length;
    const effectiveSeats = activeMembers + pendingInviteCount;

    return resolveEntitlement(
      ws?.plan,
      ws?.trial_ends_at,
      ws?.grace_ends_at,
      ws?.next_renewal_at,
      ws?.seat_limit,
      effectiveSeats,
    );
  }, [currentWorkspace, memberships, pendingInviteCount]);
}
