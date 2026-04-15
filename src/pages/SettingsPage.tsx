import { Settings, Building2, UserCircle, Crown, Rocket, Bell } from "lucide-react";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceSettingsTab } from "@/components/settings/WorkspaceSettingsTab";
import { ProfileSettingsTab } from "@/components/settings/ProfileSettingsTab";
import { PlanBillingTab } from "@/components/settings/PlanBillingTab";
import { ActivationTab } from "@/components/settings/ActivationTab";
import { NotificationPreferencesTab } from "@/components/settings/NotificationPreferencesTab";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export default function SettingsPage() {
  const { currentRole } = useWorkspace();
  const isAdmin = currentRole === "admin";

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <PageInfoButton
          title="Settings"
          description="Manage your profile, workspace configuration, plan, and activation progress."
          actions={["Update your display name and profile", "Manage workspace plan and seats (admin)", "View activation milestones (admin)"]}
          audience="All members can update profile. Admins can manage workspace settings, plan, and view activation."
        />
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile" className="gap-2">
            <UserCircle className="h-4 w-4" />
            Profile
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="workspace" className="gap-2">
              <Building2 className="h-4 w-4" />
              Workspace
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="plan" className="gap-2">
              <Crown className="h-4 w-4" />
              Plan & Billing
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="activation" className="gap-2">
              <Rocket className="h-4 w-4" />
              Activation
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profile">
          <ProfileSettingsTab />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="workspace">
            <WorkspaceSettingsTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="plan">
            <PlanBillingTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="activation">
            <ActivationTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
