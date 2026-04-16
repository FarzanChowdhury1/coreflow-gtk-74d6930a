import { useState } from "react";
import { Calendar, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { portalPostAction, type PortalSessionInfo } from "@/lib/portal-api";
import { format } from "date-fns";

interface Props {
  session: PortalSessionInfo;
}

export function PortalMeetingRequest({ session }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError(null);

    const { data, error: err } = await portalPostAction("request_meeting", {
      title: title.trim(),
      description: description.trim() || null,
      preferred_date: preferredDate || null,
      preferred_time: preferredTime || null,
    });

    if (err) {
      setError(err);
    } else {
      setSubmitted(true);
    }
    setLoading(false);
  };

  if (submitted) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500/60 mb-3" />
          <h3 className="text-sm font-medium text-foreground mb-1">Meeting Request Sent</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            Your meeting request has been submitted. The team will review and get back to you.
          </p>
          <Button variant="outline" size="sm" onClick={() => { setSubmitted(false); setTitle(""); setDescription(""); setPreferredDate(""); setPreferredTime(""); }}>
            Request Another Meeting
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Request a Meeting</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Submit a meeting request and the team will schedule it for you.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Subject *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="What would you like to discuss?"
                required
                maxLength={200}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  <Calendar className="inline h-4 w-4 mr-1" />
                  Preferred Date
                </label>
                <input
                  type="date"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  min={format(new Date(), "yyyy-MM-dd")}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  <Clock className="inline h-4 w-4 mr-1" />
                  Preferred Time
                </label>
                <select
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No preference</option>
                  <option value="morning">Morning (9–12)</option>
                  <option value="afternoon">Afternoon (12–5)</option>
                  <option value="evening">Evening (5–8)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Additional Details</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                placeholder="Any topics you'd like to cover or questions you have..."
                maxLength={1000}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={loading || !title.trim()}>
                {loading ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
