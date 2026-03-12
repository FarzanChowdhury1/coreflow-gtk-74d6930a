import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource } from "@/lib/portal-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { MessageSquare } from "lucide-react";

interface Props {
  session: PortalSessionInfo;
}

export function PortalUpdates({ session: _session }: Props) {
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUpdates = useCallback(async () => {
    setLoading(true);
    const { data, error } = await portalGetResource<any[]>("client_updates");
    if (error) console.error(error);
    setUpdates(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUpdates();
  }, [fetchUpdates]);

  if (loading) return <p className="text-center py-8 text-muted-foreground">Loading updates…</p>;
  if (updates.length === 0) return <p className="text-center py-8 text-muted-foreground">No updates yet.</p>;

  return (
    <div className="space-y-4 mt-4">
      {updates.map((update) => (
        <Card key={update.id}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-sm">{update.title}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {update.project_name || "Project Update"}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {update.published_at ? format(new Date(update.published_at), "dd MMM yyyy") : ""}
              </span>
            </div>
          </CardHeader>
          {update.body && (
            <CardContent className="pt-0">
              <p className="text-sm text-foreground whitespace-pre-wrap">{update.body}</p>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
