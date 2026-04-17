import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";

type Invoice = Tables<"invoices"> & { companies?: { legal_name: string } | null };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  partially_paid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  void: "bg-destructive/10 text-destructive",
};

interface Props {
  invoices: Invoice[];
  onSelect: (inv: Invoice) => void;
}

export function InvoiceMobileCards({ invoices, onSelect }: Props) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <div className="space-y-3">
      {invoices.map((inv) => (
        <button
          key={inv.id}
          className="w-full text-left rounded-lg border bg-card p-4 space-y-1.5 hover:bg-muted/30 transition-colors"
          onClick={() => onSelect(inv)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{inv.invoice_number}</p>
              <p className="text-xs text-muted-foreground truncate">
                {inv.companies?.legal_name || "—"}
              </p>
            </div>
            <Badge variant="secondary" className={`shrink-0 text-[10px] ${STATUS_COLORS[inv.status] || ""}`}>
              {inv.status.replace("_", " ")}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {formatCurrency(Number(inv.grand_total))}
              {Number(inv.amount_paid) > 0 && Number(inv.amount_paid) < Number(inv.grand_total) && (
                <span className="ml-1">(paid: {formatCurrency(Number(inv.amount_paid))})</span>
              )}
            </span>
            <span>{inv.due_date ? format(new Date(inv.due_date), "MMM d, yyyy") : "No due date"}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
