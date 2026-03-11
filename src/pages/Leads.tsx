import { Inbox } from "lucide-react";

export default function Leads() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Inbox className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Lead Inbox</h1>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        <p>No leads yet. They will appear here once the lead management module is built.</p>
      </div>
    </div>
  );
}
