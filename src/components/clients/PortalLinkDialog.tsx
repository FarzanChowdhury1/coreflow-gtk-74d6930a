import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Copy, Link2, Mail, Loader2, Check } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Tables<"contacts">[];
  companies: Tables<"companies">[];
}

export function PortalLinkDialog({ open, onOpenChange, contacts, companies }: Props) {
  const { currentWorkspace } = useWorkspace();
  const [contactId, setContactId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [expiryDays, setExpiryDays] = useState("30");
  const [generatedLink, setGeneratedLink] = useState("");
  const [portalToken, setPortalToken] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"idle" | "sent" | "failed" | "skipped">("idle");
  const [emailError, setEmailError] = useState<string | null>(null);

  // Filter contacts by selected company
  const filteredContacts = companyId
    ? contacts.filter((c) => c.company_id === companyId)
    : contacts;

  const selectedContact = contacts.find((c) => c.id === contactId);
  const contactHasEmail = !!selectedContact?.email;

  const handleGenerate = async () => {
    if (!currentWorkspace || !contactId || !companyId) return;
    setGenerating(true);
    setEmailStatus("idle");
    setEmailError(null);
    try {
      const { data, error } = await supabase.rpc("generate_portal_token", {
        _workspace_id: currentWorkspace.id,
        _company_id: companyId,
        _contact_id: contactId,
        _expires_in_days: Number(expiryDays),
      });

      if (error) throw error;

      const result = data as unknown as { success: boolean; token?: string; error?: string };
      if (!result.success) {
        throw new Error(result.error || "Failed to generate portal link");
      }

      const link = `${window.location.origin}/portal?token=${result.token}`;
      setGeneratedLink(link);
      setPortalToken(result.token!);
      toast.success("Portal link generated");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    toast.success("Link copied to clipboard");
  };

  const handleSendPortalEmail = async () => {
    if (!currentWorkspace || !contactId || !portalToken || sendingEmail) return;
    setSendingEmail(true);
    setEmailStatus("idle");
    setEmailError(null);

    try {
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          type: "portal",
          workspace_id: currentWorkspace.id,
          contact_id: contactId,
          portal_token: portalToken,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setEmailStatus("sent");
        toast.success(`Portal link sent to ${selectedContact?.email}`);
      } else if (data?.status === "skipped") {
        setEmailStatus("skipped");
        setEmailError(data.error);
      } else {
        setEmailStatus("failed");
        setEmailError(data?.error || "Failed to send email");
        toast.error(data?.error || "Failed to send portal email");
      }
    } catch (err: any) {
      setEmailStatus("failed");
      setEmailError(err.message || "Failed to send email");
      toast.error("Failed to send portal email");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleClose = (val: boolean) => {
    if (!val) {
      setGeneratedLink("");
      setPortalToken("");
      setContactId("");
      setCompanyId("");
      setEmailStatus("idle");
      setEmailError(null);
    }
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Generate Portal Link
          </DialogTitle>
          <DialogDescription>
            Create a secure magic link for a client to access their proposals, invoices, and payment history.
          </DialogDescription>
        </DialogHeader>

        {!generatedLink ? (
          <div className="space-y-4">
            <div>
              <Label>Company *</Label>
              <Select onValueChange={(v) => { setCompanyId(v); setContactId(""); }} value={companyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.legal_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Contact *</Label>
              <Select onValueChange={setContactId} value={contactId} disabled={!companyId}>
                <SelectTrigger>
                  <SelectValue placeholder={companyId ? "Select contact" : "Select company first"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredContacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name} {c.email ? `(${c.email})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Expires in</Label>
              <Select onValueChange={setExpiryDays} value={expiryDays}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={generating || !contactId || !companyId}>
                {generating ? "Generating…" : "Generate Link"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label>Portal Link</Label>
              <div className="flex gap-2 mt-1">
                <Input value={generatedLink} readOnly className="font-mono text-xs" />
                <Button size="icon" variant="outline" onClick={copyLink} aria-label="Copy portal link">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Share this link with your client. It expires in {expiryDays} days.
              </p>
            </div>

            {/* Email send action */}
            {contactHasEmail && emailStatus === "idle" && (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleSendPortalEmail}
                disabled={sendingEmail}
              >
                {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send to {selectedContact?.email}
              </Button>
            )}

            {!contactHasEmail && (
              <p className="text-xs text-muted-foreground rounded-md border bg-muted/50 p-3">
                This contact has no email address on file. Use the link above to share manually, or add an email to the contact record first.
              </p>
            )}

            {emailStatus === "sent" && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300">
                <Check className="inline h-4 w-4 mr-1" /> Portal link emailed to {selectedContact?.email}.
              </div>
            )}

            {emailStatus === "skipped" && (
              <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-300">
                <Mail className="inline h-4 w-4 mr-1" /> {emailError || "Email sending is not configured yet. Share the link manually."}
              </div>
            )}

            {emailStatus === "failed" && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                Email failed: {emailError || "Unknown error"}. You can still share the link manually.
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setGeneratedLink(""); setPortalToken(""); setEmailStatus("idle"); setEmailError(null); }}>
                Generate Another
              </Button>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
