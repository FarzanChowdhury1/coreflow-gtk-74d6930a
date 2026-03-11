import { Building2 } from "lucide-react";

export default function Clients() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Building2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Client Directory</h1>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        <p>Companies and contacts will be managed here.</p>
      </div>
    </div>
  );
}
