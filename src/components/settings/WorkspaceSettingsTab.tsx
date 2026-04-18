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
import { Loader2, AlertTriangle, Download, Palette, FileText } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useEntitlement } from "@/hooks/use-entitlement";
import { useNavigate } from "react-router-dom";

// CoreFlow is Bangladesh-only — currency is locked to BDT and timezone to Asia/Dhaka.
const CURRENCIES = ["BDT"];
const TIMEZONES = ["Asia/Dhaka"];

const workspaceSchema = z.object({
  name: z.string().min(1, "Workspace name is required").max(100),
  currency: z.string().min(1),
  timezone: z.string().min(1),
});

type WorkspaceFormValues = z.infer<typeof workspaceSchema>;

export function WorkspaceSettingsTab() {
  const { currentWorkspace, refreshWorkspaces } = useWorkspace();
  const { signOut } = useAuth();
  const entitlement = useEntitlement();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deactivating, setDeactivating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [claimingExport, setClaimingExport] = useState(false);
  const [exportClaimed, setExportClaimed] = useState(false);

  // Portal branding state
  const [portalAccentColor, setPortalAccentColor] = useState("");
  const [portalSupportEmail, setPortalSupportEmail] = useState("");
  const [portalLogoPath, setPortalLogoPath] = useState("");
  const [savingBranding, setSavingBranding] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Document identity (formal PDFs) state
  const [docRegisteredName, setDocRegisteredName] = useState("");
  const [docTradeName, setDocTradeName] = useState("");
  const [docAddress, setDocAddress] = useState("");
  const [docPhone, setDocPhone] = useState("");
  const [docEmail, setDocEmail] = useState("");
  const [docBin, setDocBin] = useState("");
  const [docLogoPath, setDocLogoPath] = useState("");
  const [docBankAccountName, setDocBankAccountName] = useState("");
  const [docBankAccountNumber, setDocBankAccountNumber] = useState("");
  const [docBankName, setDocBankName] = useState("");
  const [docBankBranch, setDocBankBranch] = useState("");
  const [docPaymentInstructions, setDocPaymentInstructions] = useState("");
  const [savingDocIdentity, setSavingDocIdentity] = useState(false);
  const [uploadingDocLogo, setUploadingDocLogo] = useState(false);

  const ws = currentWorkspace as any;
  const alreadyClaimed = !!ws?.offboarding_export_used_at;

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
      // Load branding fields from workspace (cast to access new columns)
      const ws = currentWorkspace as any;
      setPortalAccentColor(ws.portal_accent_color || "");
      setPortalSupportEmail(ws.portal_support_email || "");
      setPortalLogoPath(ws.portal_logo_storage_path || "");
      // Document identity fields
      setDocRegisteredName(ws.doc_registered_name || "");
      setDocTradeName(ws.doc_trade_name || "");
      setDocAddress(ws.doc_address || "");
      setDocPhone(ws.doc_phone || "");
      setDocEmail(ws.doc_email || "");
      setDocBin(ws.doc_bin || "");
      setDocLogoPath(ws.doc_logo_storage_path || "");
      setDocBankAccountName(ws.doc_bank_account_name || "");
      setDocBankAccountNumber(ws.doc_bank_account_number || "");
      setDocBankName(ws.doc_bank_name || "");
      setDocBankBranch(ws.doc_bank_branch || "");
      setDocPaymentInstructions(ws.doc_payment_instructions || "");
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

  const handleSaveBranding = async () => {
    if (!currentWorkspace) return;
    setSavingBranding(true);

    // Validate hex color if provided
    if (portalAccentColor && !/^#[0-9a-fA-F]{6}$/.test(portalAccentColor)) {
      toast.error("Accent color must be a valid hex color (e.g. #3B82F6)");
      setSavingBranding(false);
      return;
    }

    const { error } = await supabase
      .from("workspaces")
      .update({
        portal_accent_color: portalAccentColor || null,
        portal_support_email: portalSupportEmail || null,
        portal_logo_storage_path: portalLogoPath || null,
      } as any)
      .eq("id", currentWorkspace.id);

    setSavingBranding(false);
    if (error) {
      toast.error("Failed to save portal branding");
    } else {
      toast.success("Portal branding saved");
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentWorkspace) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2MB");
      return;
    }

    setUploadingLogo(true);
    const ext = file.name.split(".").pop() || "png";
    const storagePath = `${currentWorkspace.id}/portal-logo.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("workspace-files")
      .upload(storagePath, file, { upsert: true });

    if (uploadErr) {
      toast.error("Failed to upload logo");
      setUploadingLogo(false);
      return;
    }

    setPortalLogoPath(storagePath);
    setUploadingLogo(false);
    toast.success("Logo uploaded — click Save Branding to apply");
  };

  const handleSaveDocIdentity = async () => {
    if (!currentWorkspace) return;
    setSavingDocIdentity(true);
    const { error } = await supabase
      .from("workspaces")
      .update({
        doc_registered_name: docRegisteredName.trim() || null,
        doc_trade_name: docTradeName.trim() || null,
        doc_address: docAddress.trim() || null,
        doc_phone: docPhone.trim() || null,
        doc_email: docEmail.trim() || null,
        doc_bin: docBin.trim() || null,
        doc_logo_storage_path: docLogoPath || null,
        doc_bank_account_name: docBankAccountName.trim() || null,
        doc_bank_account_number: docBankAccountNumber.trim() || null,
        doc_bank_name: docBankName.trim() || null,
        doc_bank_branch: docBankBranch.trim() || null,
        doc_payment_instructions: docPaymentInstructions.trim() || null,
      } as any)
      .eq("id", currentWorkspace.id);
    setSavingDocIdentity(false);
    if (error) {
      toast.error("Failed to save document identity");
    } else {
      toast.success("Document identity saved");
      refreshWorkspaces();
    }
  };

  const handleDocLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentWorkspace) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2MB");
      return;
    }
    setUploadingDocLogo(true);
    const ext = file.name.split(".").pop() || "png";
    const storagePath = `${currentWorkspace.id}/doc-logo.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("workspace-files")
      .upload(storagePath, file, { upsert: true });
    if (uploadErr) {
      toast.error("Failed to upload document logo");
      setUploadingDocLogo(false);
      return;
    }
    setDocLogoPath(storagePath);
    setUploadingDocLogo(false);
    toast.success("Logo uploaded — click Save Document Identity to apply");
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

  const handleClaimOffboardingExport = async () => {
    if (!currentWorkspace) return;
    setClaimingExport(true);
    const { data, error } = await supabase.rpc("claim_offboarding_export", {
      _workspace_id: currentWorkspace.id,
    });
    setClaimingExport(false);

    if (error) {
      toast.error("Failed to claim offboarding export.");
      return;
    }
    const result = data as unknown as { success: boolean; error?: string; expires_at?: string } | null;
    if (!result?.success) {
      toast.error(result?.error || "Could not claim offboarding export.");
      return;
    }
    setExportClaimed(true);
    toast.success("Offboarding export unlocked for 1 hour. Redirecting to Data Export…");
    // Await workspace context refresh so FeatureGate sees fresh offboarding claim state
    await refreshWorkspaces();
    navigate("/data-export");
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

      {/* Portal Branding */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            Portal Branding
          </CardTitle>
          <CardDescription>
            Customize the appearance of your client portal. Clients will see your branding when they access their portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Accent Color</label>
              <div className="flex items-center gap-3">
                <Input
                  value={portalAccentColor}
                  onChange={(e) => setPortalAccentColor(e.target.value)}
                  placeholder="#3B82F6"
                  className="font-mono max-w-[140px]"
                  maxLength={7}
                />
                {portalAccentColor && /^#[0-9a-fA-F]{6}$/.test(portalAccentColor) && (
                  <div
                    className="h-8 w-8 rounded-md border"
                    style={{ backgroundColor: portalAccentColor }}
                  />
                )}
                <span className="text-xs text-muted-foreground">Hex format</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Support Email</label>
              <Input
                type="email"
                value={portalSupportEmail}
                onChange={(e) => setPortalSupportEmail(e.target.value)}
                placeholder="support@yourcompany.com"
              />
              <p className="text-xs text-muted-foreground">Shown in the portal footer so clients know how to reach you.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Portal Logo</label>
              <div className="flex items-center gap-3">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  disabled={uploadingLogo}
                  className="max-w-[260px]"
                />
                {uploadingLogo && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              {portalLogoPath && (
                <p className="text-xs text-muted-foreground">
                  Logo set: <span className="font-mono">{portalLogoPath.split("/").pop()}</span>
                  <button
                    type="button"
                    onClick={() => setPortalLogoPath("")}
                    className="ml-2 text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </p>
              )}
              <p className="text-xs text-muted-foreground">Max 2 MB. Displayed at 36×36px in the portal header.</p>
            </div>

            <Button onClick={handleSaveBranding} disabled={savingBranding}>
              {savingBranding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Branding
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Document Identity (formal PDFs) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Document Identity
          </CardTitle>
          <CardDescription>
            Issuer details used on formal proposal and invoice PDFs. Leave any field blank to omit it from the document — nothing is fabricated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-2xl space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Registered / Legal Name</label>
                <Input
                  value={docRegisteredName}
                  onChange={(e) => setDocRegisteredName(e.target.value)}
                  placeholder="DARVIZ Labs Ltd."
                />
                <p className="text-xs text-muted-foreground">Primary issuer line on PDFs. Falls back to workspace name when blank.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Trade / Display Name</label>
                <Input
                  value={docTradeName}
                  onChange={(e) => setDocTradeName(e.target.value)}
                  placeholder="DARVIZ"
                />
                <p className="text-xs text-muted-foreground">Optional secondary line.</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Business Address</label>
              <Textarea
                value={docAddress}
                onChange={(e) => setDocAddress(e.target.value)}
                placeholder="House 12, Road 4, Banani, Dhaka 1213, Bangladesh"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Phone</label>
                <Input
                  value={docPhone}
                  onChange={(e) => setDocPhone(e.target.value)}
                  placeholder="+880 1XXX-XXXXXX"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Document Email</label>
                <Input
                  type="email"
                  value={docEmail}
                  onChange={(e) => setDocEmail(e.target.value)}
                  placeholder="billing@yourcompany.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">BIN (Business ID)</label>
                <Input
                  value={docBin}
                  onChange={(e) => setDocBin(e.target.value)}
                  placeholder="13-digit BIN"
                  maxLength={20}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Document Logo</label>
              <div className="flex items-center gap-3">
                <Input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleDocLogoUpload}
                  disabled={uploadingDocLogo}
                  className="max-w-[260px]"
                />
                {uploadingDocLogo && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              {docLogoPath && (
                <p className="text-xs text-muted-foreground">
                  Logo set: <span className="font-mono">{docLogoPath.split("/").pop()}</span>
                  <button
                    type="button"
                    onClick={() => setDocLogoPath("")}
                    className="ml-2 text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </p>
              )}
              <p className="text-xs text-muted-foreground">PNG or JPG, max 2 MB. Rendered top-left on formal PDFs.</p>
            </div>

            <div className="border-t pt-6 space-y-4">
              <div>
                <h4 className="text-sm font-semibold">Remit / Bank Details</h4>
                <p className="text-xs text-muted-foreground mt-1">Optional. Shown on invoice PDFs when populated, omitted entirely when blank.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Account Name</label>
                  <Input value={docBankAccountName} onChange={(e) => setDocBankAccountName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Account Number</label>
                  <Input value={docBankAccountNumber} onChange={(e) => setDocBankAccountNumber(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Bank Name</label>
                  <Input value={docBankName} onChange={(e) => setDocBankName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Branch</label>
                  <Input value={docBankBranch} onChange={(e) => setDocBankBranch(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Payment Instructions</label>
                <Textarea
                  value={docPaymentInstructions}
                  onChange={(e) => setDocPaymentInstructions(e.target.value)}
                  placeholder="Wire transfer reference: invoice number. Confirm to billing@…"
                  rows={2}
                />
              </div>
            </div>

            <Button onClick={handleSaveDocIdentity} disabled={savingDocIdentity}>
              {savingDocIdentity && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Document Identity
            </Button>
          </div>
        </CardContent>
      </Card>

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

            {entitlement.features.csvExport ? (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Download className="h-4 w-4 text-primary" />
                  Export your data before deactivating
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Once deactivated, you won't be able to access your workspace. Download a full export first.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => navigate("/data-export")}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Go to Data Export
                </Button>
              </div>
            ) : alreadyClaimed || exportClaimed ? (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Download className="h-4 w-4 text-primary" />
                  Offboarding export claimed
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your one-time export window is active. Go to Data Export now to download your data before deactivating.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => navigate("/data-export")}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Go to Data Export
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-muted bg-muted/30 p-3">
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  Export your data before leaving
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  As part of offboarding, you can claim a <strong>one-time data export</strong>. This unlocks a 1-hour window to download all your workspace data. This right can only be used once.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={handleClaimOffboardingExport}
                  disabled={claimingExport}
                >
                  {claimingExport ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Claim One-Time Export
                </Button>
              </div>
            )}

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
