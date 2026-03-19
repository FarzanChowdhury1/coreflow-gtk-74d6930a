import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource } from "@/lib/portal-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";
import { format } from "date-fns";

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

  useEffect(() => { fetchUpdates(); }, [fetchUpdates]);

  if (loading) return <p className="text-center py-8 text-muted-foreground">Loading updates…</p>;

  if (updates.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-10 text-center">
          <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="text-sm font-medium text-foreground mb-1">No updates yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Your service provider will post project updates here. Check back for progress reports, milestone completions, and important announcements.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3 mt-4">
      <p className="text-sm text-muted-foreground">
        Latest updates from your service provider about ongoing projects and work.
      </p>
      {updates.map((update) => (
        <Card key={update.id}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="text-sm">{update.title}</CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                    {update.project_name || "General"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {update.published_at ? format(new Date(update.published_at), "dd MMM yyyy") : ""}
                  </span>
                </div>
              </div>
            </div>
          </CardHeader>
          {update.body && (
            <CardContent className="pt-0">
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{update.body}</p>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
