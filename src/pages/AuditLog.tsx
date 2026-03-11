import { Shield } from "lucide-react";

export default function AuditLog() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Audit Log</h1>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        <p>Immutable forensic audit records will be displayed here (read-only).</p>
      </div>
    </div>
  );
}
