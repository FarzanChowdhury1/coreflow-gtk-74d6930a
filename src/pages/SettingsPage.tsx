import { useState } from "react";
import { Settings, Building2, Users, UserCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceSettingsTab } from "@/components/settings/WorkspaceSettingsTab";
import { TeamManagementTab } from "@/components/settings/TeamManagementTab";
import { ProfileSettingsTab } from "@/components/settings/ProfileSettingsTab";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export default function SettingsPage() {
  const { currentRole } = useWorkspace();
  const isAdmin = currentRole === "admin";

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile" className="gap-2">
            <UserCircle className="h-4 w-4" />
            Profile
          </TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="workspace" className="gap-2">
                <Building2 className="h-4 w-4" />
                Workspace
              </TabsTrigger>
              <TabsTrigger value="team" className="gap-2">
                <Users className="h-4 w-4" />
                Team
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="profile">
          <ProfileSettingsTab />
        </TabsContent>

        {isAdmin && (
          <>
            <TabsContent value="workspace">
              <WorkspaceSettingsTab />
            </TabsContent>
            <TabsContent value="team">
              <TeamManagementTab />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
