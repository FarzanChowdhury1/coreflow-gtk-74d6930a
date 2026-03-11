import { Receipt } from "lucide-react";

export default function Invoices() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Receipt className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Invoice Manager</h1>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        <p>Statutory invoices with gapless numbering will be managed here.</p>
      </div>
    </div>
  );
}
