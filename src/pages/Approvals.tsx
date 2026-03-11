import { CheckSquare } from "lucide-react";

export default function ApprovalsPage() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <CheckSquare className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Approvals</h1>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        <p>Client approval records will appear here.</p>
      </div>
    </div>
  );
}
