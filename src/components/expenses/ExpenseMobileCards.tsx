import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Archive, ArchiveRestore } from "lucide-react";
import { format } from "date-fns";

interface Expense {
  id: string;
  description: string;
  amount: number;
  currency: string;
  expense_date: string;
  category: string | null;
  payment_status: string;
  deleted_at: string | null;
  vendors?: { name: string } | null;
  projects?: { name: string } | null;
}

interface Props {
  expenses: Expense[];
  isAdmin: boolean;
  onEdit: (e: Expense) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
}

export function ExpenseMobileCards({ expenses, isAdmin, onEdit, onArchive, onRestore }: Props) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <div className="space-y-3">
      {expenses.map((e) => {
        const isArchived = !!e.deleted_at;
        return (
          <div key={e.id} className={`rounded-lg border bg-card p-4 space-y-1.5 ${isArchived ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-foreground truncate flex-1">{e.description}</p>
              <span className="font-medium text-foreground shrink-0">
                {e.currency} {Number(e.amount).toLocaleString()}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{format(new Date(e.expense_date), "MMM d, yyyy")}</span>
              {e.category && <Badge variant="outline" className="text-[10px]">{e.category}</Badge>}
              <Badge variant="secondary" className="text-[10px]">{e.payment_status}</Badge>
            </div>
            {(e.vendors?.name || e.projects?.name) && (
              <p className="text-xs text-muted-foreground">
                {e.vendors?.name}{e.vendors?.name && e.projects?.name ? " · " : ""}{e.projects?.name}
              </p>
            )}
            {isAdmin && (
              <div className="flex gap-1 pt-1 border-t">
                {isArchived ? (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onRestore(e.id)}>
                    <ArchiveRestore className="h-3 w-3 mr-1" /> Restore
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEdit(e)}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => onArchive(e.id)}>
                      <Archive className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
