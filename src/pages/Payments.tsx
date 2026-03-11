import { CreditCard } from "lucide-react";

export default function Payments() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Payment Ledger</h1>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        <p>Manual payment records and proof uploads will be tracked here.</p>
      </div>
    </div>
  );
}
