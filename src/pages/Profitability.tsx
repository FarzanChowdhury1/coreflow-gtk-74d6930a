import { BarChart3 } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { ProjectProfitability as ProfitabilityView } from "@/components/projects/ProjectProfitability";

export default function Profitability() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Project Profitability</h1>
        <PageInfoButton
          title="Project Profitability"
          description="See how each project is performing financially. Revenue is based on collected payments from project-linked invoices. Expenses are direct project-linked costs only."
          actions={["View per-project margin", "Compare revenue vs direct expenses", "Identify most and least profitable projects"]}
          audience="Admins and finance teams."
          note="Shared costs like subscriptions are excluded. Only directly linked expenses and invoice payments are counted."
        />
      </div>
      <p className="mb-5 text-sm text-muted-foreground max-w-2xl">
        Direct project profitability based on collected revenue and linked expenses. Shared costs are excluded.
      </p>
      <ProfitabilityView />
    </div>
  );
}
