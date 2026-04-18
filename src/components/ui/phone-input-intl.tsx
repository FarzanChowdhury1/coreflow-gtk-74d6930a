/**
 * International phone input — backed by libphonenumber-js.
 * - Real country list with flags + calling codes
 * - Searchable popover for country selection
 * - E.164 output via onChange
 * - No silent fallback: unknown values are preserved as-is on edit
 */
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildE164,
  parseE164,
  getCountryList,
  DEFAULT_COUNTRY,
  countryToFlag,
} from "@/lib/phone";
import type { CountryCode } from "libphonenumber-js";

interface Props {
  value: string; // E.164 or empty
  onChange: (e164: string) => void;
  label?: string;
  error?: string;
  placeholder?: string;
  /** Default country when value is empty. Defaults to BD. */
  defaultCountry?: CountryCode;
  className?: string;
  id?: string;
}

export function PhoneInputIntl({
  value,
  onChange,
  label,
  error,
  placeholder = "1712 345 678",
  defaultCountry = DEFAULT_COUNTRY,
  className,
  id,
}: Props) {
  const countries = useMemo(() => getCountryList(), []);
  const [open, setOpen] = useState(false);

  // Local UI state derived from value. We only re-derive when value changes
  // EXTERNALLY (e.g., loading an existing record); typing keeps local state.
  const initial = useMemo(() => {
    const parsed = parseE164(value);
    return {
      country: parsed.country ?? (value ? null : defaultCountry),
      national: parsed.national,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [country, setCountry] = useState<CountryCode | null>(initial.country);
  const [national, setNational] = useState<string>(initial.national);

  // If parent resets value to empty (e.g. reopening dialog), reset local state.
  useEffect(() => {
    if (!value) {
      setCountry(defaultCountry);
      setNational("");
      return;
    }
    // If parent value is a fully valid number that doesn't match local state
    // (e.g. switching contact), re-parse without silent fallback.
    const parsed = parseE164(value);
    if (parsed.e164 && parsed.e164 !== buildE164(country, national)) {
      setCountry(parsed.country ?? country);
      setNational(parsed.national);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (nextCountry: CountryCode | null, nextNational: string) => {
    const e164 = buildE164(nextCountry, nextNational);
    onChange(e164);
  };

  const selected = country ? countries.find((c) => c.code === country) : null;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-label="Select country"
              className="h-10 w-[120px] shrink-0 justify-between px-2 font-normal"
            >
              <span className="flex items-center gap-1 truncate">
                <span className="text-base leading-none">
                  {selected ? selected.flag : "🌐"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {selected ? selected.callingCode : "+?"}
                </span>
              </span>
              <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search country..." />
              <CommandList>
                <CommandEmpty>No country found.</CommandEmpty>
                <CommandGroup>
                  {countries.map((c) => (
                    <CommandItem
                      key={c.code}
                      value={`${c.name} ${c.callingCode} ${c.code}`}
                      onSelect={() => {
                        setCountry(c.code);
                        setOpen(false);
                        emit(c.code, national);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          country === c.code ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="mr-2">{c.flag}</span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.callingCode}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={national}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[^\d\s\-().]/g, "");
            setNational(cleaned);
            emit(country, cleaned);
          }}
          className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={placeholder}
        />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

// re-export for convenience
export { countryToFlag };
