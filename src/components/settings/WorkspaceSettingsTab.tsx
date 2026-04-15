import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, AlertTriangle, Download } from "lucide-react";
import { useEntitlement } from "@/hooks/use-entitlement";
import { useNavigate } from "react-router-dom";

const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "AED", "SGD"];
const TIMEZONES = [
  "Asia/Dhaka",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

const workspaceSchema = z.object({
  name: z.string().min(1, "Workspace name is required").max(100),
  currency: z.string().min(1),
  timezone: z.string().min(1),
});

type WorkspaceFormValues = z.infer<typeof workspaceSchema>;

export function WorkspaceSettingsTab() {
  const { currentWorkspace, refreshWorkspaces } = useWorkspace();
  const { signOut } = useAuth();
  const [saving, setSaving] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deactivating, setDeactivating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: {
      name: currentWorkspace?.name || "",
      currency: currentWorkspace?.currency || "BDT",
      timezone: currentWorkspace?.timezone || "Asia/Dhaka",
    },
  });

  useEffect(() => {
    if (currentWorkspace) {
      form.reset({
        name: currentWorkspace.name,
        currency: currentWorkspace.currency,
        timezone: currentWorkspace.timezone,
      });
    }
  }, [currentWorkspace]);

  const onSubmit = async (values: WorkspaceFormValues) => {
    if (!currentWorkspace) return;
    setSaving(true);
    const { error } = await supabase
      .from("workspaces")
      .update({
        name: values.name,
        currency: values.currency,
        timezone: values.timezone,
      })
      .eq("id", currentWorkspace.id);
    setSaving(false);

    if (error) {
      toast.error("Failed to update workspace");
    } else {
      toast.success("Workspace settings saved");
    }
  };

  const handleDeactivate = async () => {
    if (!currentWorkspace) return;
    setDeactivating(true);

    const { data, error } = await supabase.rpc("deactivate_workspace", {
      _workspace_id: currentWorkspace.id,
      _confirm_name: confirmName,
    });

    setDeactivating(false);

    if (error) {
      toast.error("Deactivation failed. Please try again.");
      return;
    }

    const result = data as unknown as { success: boolean; error?: string } | null;
    if (!result?.success) {
      toast.error(result?.error || "Deactivation failed.");
      return;
    }

    toast.success("Workspace deactivated. You will be signed out.");
    setDialogOpen(false);
    setConfirmName("");

    // Small delay so user sees the toast, then sign out
    setTimeout(() => {
      refreshWorkspaces();
      signOut();
    }, 1500);
  };

  const nameMatches = currentWorkspace && confirmName.trim() === currentWorkspace.name.trim();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace Configuration</CardTitle>
          <CardDescription>Manage workspace name, default currency, and timezone</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Workspace Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Currency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Timezone</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Settings
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Danger zone — workspace deactivation */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Deactivate this workspace. This will make it inaccessible to all members. All data is preserved but the workspace cannot be used until reactivated by platform support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
              <p className="text-sm text-muted-foreground">
                <strong>What happens when you deactivate:</strong>
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground space-y-0.5">
                <li>The workspace becomes invisible and inaccessible to all members</li>
                <li>All pending invites are expired immediately</li>
                <li>All active portal links are revoked</li>
                <li>No data is deleted — invoices, projects, and records are preserved</li>
                <li>You will be signed out after deactivation</li>
              </ul>
            </div>

            <AlertDialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setConfirmName(""); }}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Deactivate Workspace
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deactivate "{currentWorkspace?.name}"?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3">
                      <p>
                        This will make the workspace inaccessible to all members. All data is preserved but the workspace cannot be used until reactivated.
                      </p>
                      <p className="font-medium text-foreground">
                        Type <span className="font-mono bg-muted px-1 rounded">{currentWorkspace?.name}</span> to confirm:
                      </p>
                      <Input
                        value={confirmName}
                        onChange={(e) => setConfirmName(e.target.value)}
                        placeholder="Type workspace name here"
                        autoComplete="off"
                      />
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeactivate}
                    disabled={!nameMatches || deactivating}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Deactivate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
