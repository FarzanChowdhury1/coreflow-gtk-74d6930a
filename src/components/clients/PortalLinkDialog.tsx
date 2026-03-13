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
import { Copy, Link2 } from "lucide-react";
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
  const [generating, setGenerating] = useState(false);

  // Filter contacts by selected company
  const filteredContacts = companyId
    ? contacts.filter((c) => c.company_id === companyId)
    : contacts;

  const handleGenerate = async () => {
    if (!currentWorkspace || !contactId || !companyId) return;
    setGenerating(true);
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

  const handleClose = (val: boolean) => {
    if (!val) {
      setGeneratedLink("");
      setContactId("");
      setCompanyId("");
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
                <Button size="icon" variant="outline" onClick={copyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Share this link with your client. It expires in {expiryDays} days.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setGeneratedLink("")}>
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
