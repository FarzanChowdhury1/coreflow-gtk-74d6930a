import { Users, Building, Users2 } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { TeamManagementTab } from "@/components/settings/TeamManagementTab";
import { DepartmentManager } from "@/components/team/DepartmentManager";
import { TeamPodManager } from "@/components/team/TeamPodManager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Team() {
  // Route-level AdminGuard in App.tsx enforces admin-only access

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Internal Team</h1>
        <PageInfoButton
          title="Internal Team"
          description="Manage your internal workspace members, departments, and working teams. This is not for clients — client companies and contacts are in the Clients section."
          actions={["Invite and manage workspace members", "Create departments (functional groups)", "Create teams/pods (cross-functional working groups)", "Assign members to departments and teams"]}
          audience="Admins managing internal organization."
          note="Departments are permanent functional groups. Teams/pods are flexible working groups that can span departments."
        />
      </div>
      <p className="mb-5 text-sm text-muted-foreground max-w-2xl">
        Manage your internal workspace members, departments, and working teams.
        These are your employees and collaborators — not clients.
        Client companies and contacts are managed in the Clients section.
      </p>

      <Tabs defaultValue="members" className="space-y-6">
        <TabsList>
          <TabsTrigger value="members" className="gap-2">
            <Users className="h-4 w-4" />
            Members
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-2">
            <Building className="h-4 w-4" />
            Departments
          </TabsTrigger>
          <TabsTrigger value="teams" className="gap-2">
            <Users2 className="h-4 w-4" />
            Teams &amp; Pods
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <TeamManagementTab />
        </TabsContent>

        <TabsContent value="departments">
          <DepartmentManager />
        </TabsContent>

        <TabsContent value="teams">
          <TeamPodManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
