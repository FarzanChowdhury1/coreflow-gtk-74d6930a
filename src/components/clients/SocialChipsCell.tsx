import { ExternalLink, Link2 } from "lucide-react";
import { normalizeSocials, platformLabel, socialToHref } from "@/lib/socials";

/**
 * Compact desktop cell renderer for socials JSONB.
 * - 0 entries → em dash
 * - 1 entry  → small clickable chip with platform label
 * - 2+       → first chip + "+N" with title tooltip listing all platforms
 * Stays dense; never spills raw URLs into the table.
 */
export function SocialChipsCell({ socials }: { socials: unknown }) {
  const list = normalizeSocials(socials);
  if (list.length === 0) return <span className="text-muted-foreground">—</span>;

  const first = list[0];
  const firstHref = socialToHref(first);
  const tooltip = list.map((s) => `${platformLabel(s.platform)}: ${s.value}`).join("\n");

  const Chip = (
    <span
      className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] text-foreground"
      title={tooltip}
    >
      <Link2 className="h-3 w-3 text-muted-foreground" />
      {platformLabel(first.platform)}
      {firstHref && <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />}
    </span>
  );

  return (
    <div className="flex items-center gap-1" title={tooltip}>
      {firstHref ? (
        <a
          href={firstHref}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:opacity-80"
          onClick={(e) => e.stopPropagation()}
        >
          {Chip}
        </a>
      ) : (
        Chip
      )}
      {list.length > 1 && (
        <span className="text-[10px] text-muted-foreground/80">+{list.length - 1}</span>
      )}
    </div>
  );
}
