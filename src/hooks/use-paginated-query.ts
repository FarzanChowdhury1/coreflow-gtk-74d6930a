import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 50;

interface UsePaginatedQueryOptions {
  table: string;
  queryKey: string[];
  workspaceId: string | undefined;
  select?: string;
  orderBy?: string;
  ascending?: boolean;
  filters?: (query: any) => any;
  enabled?: boolean;
}

export function usePaginatedQuery<T = any>({
  table,
  queryKey,
  workspaceId,
  select = "*",
  orderBy = "created_at",
  ascending = false,
  filters,
  enabled = true,
}: UsePaginatedQueryOptions) {
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: [...queryKey, page],
    queryFn: async () => {
      if (!workspaceId) return { rows: [] as T[], count: 0 };

      let countQuery = supabase
        .from(table as any)
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      if (filters) countQuery = filters(countQuery);

      let dataQuery = supabase
        .from(table as any)
        .select(select)
        .eq("workspace_id", workspaceId)
        .order(orderBy, { ascending })
        .range(from, to);
      if (filters) dataQuery = filters(dataQuery);

      const [countRes, dataRes] = await Promise.all([countQuery, dataQuery]);
      if (dataRes.error) throw dataRes.error;

      return {
        rows: (dataRes.data ?? []) as T[],
        count: countRes.count ?? 0,
      };
    },
    enabled: !!workspaceId && enabled,
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  const nextPage = useCallback(() => {
    if (hasNext) setPage((p) => p + 1);
  }, [hasNext]);

  const prevPage = useCallback(() => {
    if (hasPrev) setPage((p) => p - 1);
  }, [hasPrev]);

  const resetPage = useCallback(() => setPage(0), []);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    rows,
    totalCount,
    page,
    totalPages,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    resetPage,
    isLoading,
    isFetching,
    isError,
    invalidate,
    PAGE_SIZE,
  };
}
