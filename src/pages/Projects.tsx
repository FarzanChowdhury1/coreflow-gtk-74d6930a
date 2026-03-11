import { FolderKanban } from "lucide-react";

export default function Projects() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <FolderKanban className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Project Tracker</h1>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        <p>Active projects and tasks will be tracked here.</p>
      </div>
    </div>
  );
}
