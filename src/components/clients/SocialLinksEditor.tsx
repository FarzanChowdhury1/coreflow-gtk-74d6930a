import { Plus, X } from "lucide-react";
import {
  SOCIAL_PLATFORMS,
  type SocialEntry,
  type SocialPlatform,
} from "@/lib/socials";

interface Props {
  value: SocialEntry[];
  onChange: (next: SocialEntry[]) => void;
  errors?: Record<number, string>;
  max?: number;
  label?: string;
}

const DEFAULT_MAX = 10;

/**
 * Reusable structured editor for social handles / links.
 * Used by both Company and Contact forms — same shape, same UX.
 */
export function SocialLinksEditor({ value, onChange, errors, max = DEFAULT_MAX, label = "Social profiles" }: Props) {
  const items = value;

  const addEntry = () => {
    if (items.length >= max) return;
    const used = new Set(items.map((i) => i.platform));
    const next = (SOCIAL_PLATFORMS.find((p) => !used.has(p.value))?.value ??
      "website") as SocialPlatform;
    onChange([...items, { platform: next, value: "" }]);
  };

  const updateEntry = (idx: number, patch: Partial<SocialEntry>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeEntry = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const placeholderFor = (p: SocialPlatform) =>
    SOCIAL_PLATFORMS.find((opt) => opt.value === p)?.placeholder ?? "";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="block text-sm font-medium text-foreground">{label}</label>
        {items.length < max && (
          <button
            type="button"
            onClick={addEntry}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="h-3 w-3" /> Add profile
          </button>
        )}
      </div>

      {items.length === 0 && (
        <button
          type="button"
          onClick={addEntry}
          className="w-full rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50"
        >
          + Add a social profile or website
        </button>
      )}

      <div className="space-y-2">
        {items.map((entry, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-2">
              <select
                value={entry.platform}
                onChange={(e) => updateEntry(i, { platform: e.target.value as SocialPlatform })}
                className="h-10 w-[120px] shrink-0 rounded-md border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={entry.value}
                onChange={(e) => updateEntry(i, { value: e.target.value })}
                placeholder={placeholderFor(entry.platform)}
                maxLength={500}
                className="h-10 flex-1 rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => removeEntry(i)}
                className="h-10 w-10 shrink-0 rounded-md border text-muted-foreground hover:text-destructive flex items-center justify-center"
                aria-label="Remove profile"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {errors?.[i] && <p className="ml-[128px] text-xs text-destructive">{errors[i]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
