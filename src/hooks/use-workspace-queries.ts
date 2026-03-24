/**
 * Shared TanStack Query hooks for common workspace-scoped data.
 * Eliminates duplicate fetch logic across pages.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useWorkspaceCompanies(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["companies", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

export function useWorkspaceContacts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["contacts", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("workspace_memberships")
        .select("user_id, role")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

/**
 * Fetch the latest version per proposal using the DB view `latest_proposal_versions`.
 * DISTINCT ON runs server-side — no client-side dedup, scales with data.
 */
export function useLatestProposalVersions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["proposal_versions_latest", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("latest_proposal_versions" as "proposal_versions")
        .select("id, proposal_id, version_number, status, grand_total, currency")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}
