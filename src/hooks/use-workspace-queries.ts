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
 * Fetch the latest version per proposal in a single query.
 * Uses DISTINCT ON via ordering — returns one row per proposal_id (the highest version_number).
 */
export function useLatestProposalVersions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["proposal_versions_latest", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      // Fetch all versions ordered by proposal_id + version_number desc,
      // then deduplicate client-side to get latest per proposal.
      const { data, error } = await supabase
        .from("proposal_versions")
        .select("id, proposal_id, version_number, status, grand_total, currency")
        .eq("workspace_id", workspaceId)
        .order("version_number", { ascending: false });
      if (error) throw error;
      if (!data) return [];

      // Deduplicate: keep first occurrence per proposal_id (highest version_number)
      const seen = new Set<string>();
      return data.filter((v) => {
        if (seen.has(v.proposal_id)) return false;
        seen.add(v.proposal_id);
        return true;
      });
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}
