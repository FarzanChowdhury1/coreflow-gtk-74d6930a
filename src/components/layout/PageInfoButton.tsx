import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface PageInfoButtonProps {
  title: string;
  description: string;
  actions?: string[];
  audience?: string;
  note?: string;
}

export function PageInfoButton({ title, description, actions, audience, note }: PageInfoButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground">
          <Info className="h-4 w-4" />
          <span className="sr-only">Page info</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm space-y-2">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground leading-relaxed">{description}</p>
        {actions && actions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground mb-1">What you can do here:</p>
            <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
              {actions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}
        {audience && (
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Who uses this:</span> {audience}</p>
        )}
        {note && (
          <p className="text-xs text-muted-foreground italic">{note}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
