import { Users } from "lucide-react";
import { TeamManagementTab } from "@/components/settings/TeamManagementTab";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Navigate } from "react-router-dom";

export default function Team() {
  const { currentRole } = useWorkspace();

  if (currentRole !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Internal Team</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground max-w-2xl">
        Manage your internal workspace members. These are your employees and collaborators — not clients.
        Client companies and contacts are managed in the Clients section.
      </p>
      <TeamManagementTab />
    </div>
  );
}
