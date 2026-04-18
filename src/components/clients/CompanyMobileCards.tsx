import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Archive, RotateCcw, Shield, Calendar, Link2, ClipboardList, ExternalLink } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { normalizeSocials, platformLabel, socialToHref } from "@/lib/socials";

type Company = Tables<"companies">;

interface Props {
  companies: Company[];
  isAdmin: boolean;
  onEdit: (c: Company) => void;
  onArchive: (c: Company) => void;
  onRestore: (c: Company) => void;
  onAccess: (c: Company) => void;
  onPortal: () => void;
  onMeeting: (companyId: string) => void;
  onOnboarding: (c: Company) => void;
}

export function CompanyMobileCards({
  companies,
  isAdmin,
  onEdit,
  onArchive,
  onRestore,
  onAccess,
  onMeeting,
  onOnboarding,
}: Props) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <div className="space-y-3">
      {companies.map((c) => {
        const isArchived = !!c.deleted_at;
        const socials = normalizeSocials((c as any).socials);
        return (
          <div key={c.id} className={`rounded-lg border bg-card p-4 space-y-2 ${isArchived ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{c.legal_name}</p>
                {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
              </div>
              {isArchived && <Badge variant="outline" className="text-[10px] shrink-0">Archived</Badge>}
            </div>
            {c.address && <p className="text-xs text-muted-foreground truncate">{c.address}</p>}
            {socials.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {socials.map((s, i) => {
                  const href = socialToHref(s);
                  const content = (
                    <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-[10px] text-foreground">
                      {platformLabel(s.platform)}
                      {href && <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />}
                    </span>
                  );
                  return href ? (
                    <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
                      {content}
                    </a>
                  ) : (
                    <span key={i}>{content}</span>
                  );
                })}
              </div>
            )}
            {isAdmin && (
              <div className="flex flex-wrap gap-1 pt-1 border-t">
                {isArchived ? (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onRestore(c)}>
                    <RotateCcw className="h-3 w-3 mr-1" /> Restore
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEdit(c)}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onAccess(c)}>
                      <Shield className="h-3 w-3 mr-1" /> Access
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onMeeting(c.id)}>
                      <Calendar className="h-3 w-3 mr-1" /> Meet
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onOnboarding(c)}>
                      <ClipboardList className="h-3 w-3 mr-1" /> Tasks
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => onArchive(c)}>
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
