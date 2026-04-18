import { useMemo } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { resolveEntitlement, type WorkspaceEntitlement } from "@/lib/entitlements";

export function useEntitlement(): WorkspaceEntitlement {
  const { currentWorkspace, memberships } = useWorkspace();

  return useMemo(() => {
    const ws = currentWorkspace as any;
    const seatCount = memberships.filter(
      (m) => m.workspace_id === currentWorkspace?.id
    ).length;

    return resolveEntitlement(
      ws?.plan,
      ws?.trial_ends_at,
      ws?.grace_ends_at,
      ws?.next_renewal_at,
      ws?.seat_limit,
      seatCount,
    );
  }, [currentWorkspace, memberships]);
}
