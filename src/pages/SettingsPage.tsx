import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Workspace Settings</h1>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        <p>Workspace configuration, team management, and BIN settings will be here.</p>
      </div>
    </div>
  );
}
