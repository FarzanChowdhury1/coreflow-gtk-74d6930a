import { FileText } from "lucide-react";

export default function Proposals() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <FileText className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Proposal Builder</h1>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        <p>Proposals and versioned pricing will be managed here.</p>
      </div>
    </div>
  );
}
