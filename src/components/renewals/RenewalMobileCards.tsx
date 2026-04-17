import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Pause, Play, Receipt, FileText } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";

interface Renewal {
  id: string;
  label: string;
  amount: number;
  currency: string;
  interval_months: number;
  next_billing_date: string;
  is_active: boolean;
  companies?: { legal_name: string } | null;
}

interface Props {
  renewals: Renewal[];
  isAdmin: boolean;
  urgencyBucket: (date: string) => string;
  bucketConfig: Record<string, { label: string; color: string }>;
  onEdit: (r: Renewal) => void;
  onToggle: (r: Renewal) => void;
  onGenerate: (r: Renewal) => void;
  generatingId: string | null;
}

export function RenewalMobileCards({
  renewals, isAdmin, urgencyBucket, bucketConfig, onEdit, onToggle, onGenerate, generatingId,
}: Props) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <div className="space-y-3">
      {renewals.map((r) => {
        const bucket = urgencyBucket(r.next_billing_date);
        const cfg = bucketConfig[bucket];
        return (
          <div key={r.id} className={`rounded-lg border bg-card p-4 space-y-1.5 ${!r.is_active ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.companies?.legal_name || "—"}</p>
              </div>
              <span className="font-medium text-foreground shrink-0">
                {formatCurrency(Number(r.amount))}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={`text-[10px] ${cfg?.color || ""}`}>
                {cfg?.label || bucket}
              </Badge>
              <span className="text-muted-foreground">
                Next: {format(new Date(r.next_billing_date), "MMM d, yyyy")}
              </span>
              <span className="text-muted-foreground">
                Every {r.interval_months}mo
              </span>
              {!r.is_active && <Badge variant="secondary" className="text-[10px]">Paused</Badge>}
            </div>
            {isAdmin && (
              <div className="flex gap-1 pt-1 border-t">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEdit(r)}>
                  <Pencil className="h-3 w-3 mr-1" /> Edit
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onToggle(r)}>
                  {r.is_active ? <><Pause className="h-3 w-3 mr-1" /> Pause</> : <><Play className="h-3 w-3 mr-1" /> Resume</>}
                </Button>
                {r.is_active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={generatingId === r.id}
                    onClick={() => onGenerate(r)}
                  >
                    <Receipt className="h-3 w-3 mr-1" /> Invoice
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
