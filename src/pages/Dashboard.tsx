import { LayoutDashboard } from "lucide-react";

export default function Dashboard() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <LayoutDashboard className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {["Active Leads", "Open Proposals", "Running Projects", "Pending Invoices"].map((label) => (
          <div key={label} className="rounded-lg border bg-card p-5">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-card-foreground">0</p>
          </div>
        ))}
      </div>
    </div>
  );
}
