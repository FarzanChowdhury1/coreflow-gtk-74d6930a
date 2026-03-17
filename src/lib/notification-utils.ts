const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Sort notifications by priority:
 *  1. unread critical  2. unread warning  3. unread info
 *  4. read critical    5. read warning    6. read info
 * Within each bucket, newest first.
 */
export function sortByPriority<T extends { is_read: boolean; severity?: string; created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aRead = a.is_read ? 1 : 0;
    const bRead = b.is_read ? 1 : 0;
    if (aRead !== bRead) return aRead - bRead;

    const aSev = SEVERITY_RANK[a.severity || "info"] ?? 2;
    const bSev = SEVERITY_RANK[b.severity || "info"] ?? 2;
    if (aSev !== bSev) return aSev - bSev;

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
