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

const TYPE_META: Record<string, { icon: typeof Building2; label: string; color: string }> = {
  company: { icon: Building2, label: "Company", color: "text-primary" },
  contact: { icon: User, label: "Contact", color: "text-blue-500" },
  lead: { icon: Inbox, label: "Lead", color: "text-amber-500" },
  proposal: { icon: FileText, label: "Proposal", color: "text-violet-500" },
  project: { icon: FolderKanban, label: "Project", color: "text-green-500" },
  invoice: { icon: Receipt, label: "Invoice", color: "text-red-500" },
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

      const like = `%${term}%`;
      const [companies, contacts, leads, proposals, projects, invoices] = await Promise.all([
        supabase
          .from("companies")
          .select("id, legal_name")
          .eq("workspace_id", wsId)
          .is("deleted_at", null)
          .ilike("legal_name", like)
          .limit(5),
        supabase
          .from("contacts")
          .select("id, full_name, email, company_id")
          .eq("workspace_id", wsId)
          .is("deleted_at", null)
          .or(`full_name.ilike.${like},email.ilike.${like}`)
          .limit(5),
        supabase
          .from("leads")
          .select("id, title, status")
          .eq("workspace_id", wsId)
          .is("deleted_at", null)
          .ilike("title", like)
          .limit(5),
        supabase
          .from("proposals")
          .select("id, title")
          .eq("workspace_id", wsId)
          .is("deleted_at", null)
          .ilike("title", like)
          .limit(5),
        supabase
          .from("projects")
          .select("id, name, status")
          .eq("workspace_id", wsId)
          .is("deleted_at", null)
          .ilike("name", like)
          .limit(5),
        supabase
          .from("invoices")
          .select("id, invoice_number, grand_total, currency")
          .eq("workspace_id", wsId)
          .is("deleted_at", null)
          .ilike("invoice_number", like)
          .limit(5),
      ]);

      const items: SearchResult[] = [];

      (companies.data ?? []).forEach((c) =>
        items.push({ id: c.id, type: "company", title: c.legal_name, href: `/clients?highlight=${c.id}` })
      );
      (contacts.data ?? []).forEach((c) =>
        items.push({
          id: c.id,
          type: "contact",
          title: c.full_name,
          subtitle: c.email ?? undefined,
          href: `/clients?tab=contacts&highlight=${c.id}`,
        })
      );
      (leads.data ?? []).forEach((l) =>
        items.push({
          id: l.id,
          type: "lead",
          title: l.title,
          subtitle: l.status,
          href: `/leads?highlight=${l.id}`,
        })
      );
      (proposals.data ?? []).forEach((p) =>
        items.push({ id: p.id, type: "proposal", title: p.title, href: `/proposals?open=${p.id}` })
      );
      (projects.data ?? []).forEach((p) =>
        items.push({
          id: p.id,
          type: "project",
          title: p.name,
          subtitle: p.status,
          href: `/projects?open=${p.id}`,
        })
      );
      (invoices.data ?? []).forEach((inv) =>
        items.push({
          id: inv.id,
          type: "invoice",
          title: inv.invoice_number,
          subtitle: `${inv.currency} ${inv.grand_total?.toLocaleString() ?? 0}`,
          href: `/invoices?open=${inv.id}`,
        })
      );

      setResults(items);
      setLoading(false);
    },
    [wsId]
  );

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(query), 250);
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
              const meta = TYPE_META[type];
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
