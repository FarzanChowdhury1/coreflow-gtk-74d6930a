import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Project {
  id: string;
  name: string;
  status: string;
  company_id: string | null;
  companies?: { legal_name: string } | null;
  start_date?: string | null;
  target_end_date?: string | null;
}

interface Props {
  projects: Project[];
  statusColors: Record<string, string>;
  onSelect: (id: string) => void;
}

export function ProjectMobileCards({ projects, statusColors, onSelect }: Props) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <div className="space-y-3">
      {projects.map((p) => (
        <button
          key={p.id}
          className="w-full text-left rounded-lg border bg-card p-4 space-y-1.5 hover:bg-muted/30 transition-colors"
          onClick={() => onSelect(p.id)}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-foreground truncate">{p.name}</p>
            <Badge variant="secondary" className={`shrink-0 text-[10px] ${statusColors[p.status] || ""}`}>
              {p.status.replace("_", " ")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {p.companies?.legal_name || (p.company_id ? "—" : "Internal")}
          </p>
          {(p.start_date || p.target_end_date) && (
            <p className="text-xs text-muted-foreground">
              {p.start_date ? new Date(p.start_date).toLocaleDateString() : "—"}
              {" → "}
              {p.target_end_date ? new Date(p.target_end_date).toLocaleDateString() : "—"}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}
