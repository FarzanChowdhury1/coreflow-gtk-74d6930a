import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Archive, RotateCcw, ExternalLink } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { normalizePhones, labelDisplay, formatPhoneDisplay } from "@/lib/phone";
import { normalizeSocials, platformLabel, socialToHref } from "@/lib/socials";

type Contact = Tables<"contacts">;

interface Props {
  contacts: Contact[];
  isAdmin: boolean;
  getCompanyName: (id: string | null) => React.ReactNode;
  onEdit: (c: Contact) => void;
  onArchive: (c: Contact) => void;
  onRestore: (c: Contact) => void;
}

export function ContactMobileCards({ contacts, isAdmin, getCompanyName, onEdit, onArchive, onRestore }: Props) {
  return (
    <div className="space-y-3">
      {contacts.map((contact) => {
        const isArchived = !!contact.deleted_at;
        // Prefer structured phones[]; fall back to legacy phone/alt_phone if empty
        let phones = normalizePhones((contact as any).phones);
        if (phones.length === 0) {
          if (contact.phone) phones.push({ label: "primary", number: contact.phone });
          if ((contact as any).alt_phone) phones.push({ label: "alternate", number: (contact as any).alt_phone });
        }
        const socials = normalizeSocials((contact as any).socials);
        return (
          <div
            key={contact.id}
            className={`rounded-lg border bg-card p-4 ${isArchived ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="font-medium text-foreground">{contact.full_name}</p>
                {contact.designation && (
                  <p className="text-xs text-muted-foreground">{contact.designation}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                {isArchived && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
                {!isArchived && (contact as any).lifecycle_status && (contact as any).lifecycle_status !== "active" && (
                  <Badge variant="secondary" className="text-[10px]">
                    {(contact as any).lifecycle_status === "left_company" ? "Left Company" : (contact as any).lifecycle_status === "bounced" ? "Bounced" : "Inactive"}
                  </Badge>
                )}
              </div>
            </div>

            <div className="space-y-1 text-sm text-muted-foreground mb-3">
              {contact.email && <p className="break-all">{contact.email}</p>}
              {phones.length > 0 && (
                <div className="space-y-0.5">
                  {phones.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 w-14 shrink-0">
                        {labelDisplay(p.label)}
                      </span>
                      <span className="font-mono text-xs text-foreground">
                        {formatPhoneDisplay(p.number) || p.number}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p>Company: {getCompanyName(contact.company_id)}</p>
            </div>

            {isAdmin && (
              <div className="flex gap-1">
                {isArchived ? (
                  <Button variant="ghost" size="sm" onClick={() => onRestore(contact)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(contact)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onArchive(contact)}
                    >
                      <Archive className="h-3.5 w-3.5" />
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
