import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  Building2, User, Inbox, FileText, FolderKanban, Receipt, Search,
} from "lucide-react";

interface SearchResult {
  id: string;
  type: "company" | "contact" | "lead" | "proposal" | "project" | "invoice";
  title: string;
  subtitle?: string;
  href: string;
}

const TYPE_META: Record<string, { icon: typeof Building2; label: string; color: string; hrefFn: (id: string) => string }> = {
  companies: { icon: Building2, label: "Company", color: "text-primary", hrefFn: (id) => `/clients?highlight=${id}` },
  contacts: { icon: User, label: "Contact", color: "text-blue-500", hrefFn: (id) => `/clients?tab=contacts&highlight=${id}` },
  leads: { icon: Inbox, label: "Lead", color: "text-amber-500", hrefFn: (id) => `/leads?highlight=${id}` },
  proposals: { icon: FileText, label: "Proposal", color: "text-violet-500", hrefFn: (id) => `/proposals?open=${id}` },
  projects: { icon: FolderKanban, label: "Project", color: "text-green-500", hrefFn: (id) => `/projects?open=${id}` },
  invoices: { icon: Receipt, label: "Invoice", color: "text-red-500", hrefFn: (id) => `/invoices?open=${id}` },
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const { currentWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const wsId = currentWorkspace?.id;

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const search = useCallback(
    async (term: string) => {
      if (!wsId || term.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);

      const { data, error } = await supabase.rpc("global_search", {
        _workspace_id: wsId,
        _term: term,
        _limit: 5,
      });

      if (error || !data) {
        setResults([]);
        setLoading(false);
        return;
      }

      const items: SearchResult[] = [];
      const groups = data as Record<string, Array<{ id: string; title: string; subtitle: string | null }>>;

      for (const [groupKey, entries] of Object.entries(groups)) {
        const meta = TYPE_META[groupKey];
        if (!meta) continue;
        for (const entry of entries) {
          items.push({
            id: entry.id,
            type: groupKey.replace(/s$/, "") as SearchResult["type"],
            title: entry.title,
            subtitle: entry.subtitle ?? undefined,
            href: meta.hrefFn(entry.id),
          });
        }
      }

      setResults(items);
      setLoading(false);
    },
    [wsId]
  );

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, open, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    results.forEach((r) => {
      if (!groups[r.type]) groups[r.type] = [];
      groups[r.type].push(r);
    });
    return groups;
  }, [results]);

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery("");
    navigate(result.href);
  };

  // Map singular type back to TYPE_META plural key for icon/color
  const getMetaForType = (type: string) => {
    const key = type + "s";
    return TYPE_META[key] ?? TYPE_META.companies;
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative hidden sm:flex items-center h-9 w-48 md:w-64 rounded-md border bg-background pl-9 pr-3 text-sm text-muted-foreground hover:border-ring transition-colors"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <span>Search…</span>
        <kbd className="ml-auto hidden md:inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search companies, leads, proposals, projects, invoices…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {query.length < 2 ? (
            <CommandEmpty>Type at least 2 characters to search…</CommandEmpty>
          ) : loading ? (
            <CommandEmpty>Searching…</CommandEmpty>
          ) : results.length === 0 ? (
            <CommandEmpty>No results found.</CommandEmpty>
          ) : (
            Object.entries(grouped).map(([type, items]) => {
              const meta = getMetaForType(type);
              const Icon = meta.icon;
              return (
                <CommandGroup key={type} heading={meta.label + "s"}>
                  {items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${item.type}-${item.title}`}
                      onSelect={() => handleSelect(item)}
                      className="gap-3"
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-foreground">
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {item.subtitle}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
