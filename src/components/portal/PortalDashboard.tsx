import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortalProposals } from "./PortalProposals";
import { PortalInvoices } from "./PortalInvoices";
import { PortalPayments } from "./PortalPayments";
import { Building2, FileText, Receipt, CreditCard, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { portalLogout, type PortalSessionInfo } from "@/lib/portal-api";

interface Props {
  session: PortalSessionInfo;
}

export function PortalDashboard({ session }: Props) {
  const handleLogout = async () => {
    await portalLogout();
    window.location.href = "/portal";
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold text-foreground">{session.company_name}</h1>
              <p className="text-xs text-muted-foreground">
                Welcome, {session.contact_name} · {session.contact_email}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="mr-1 h-4 w-4" /> Exit
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        <Tabs defaultValue="proposals">
          <TabsList>
            <TabsTrigger value="proposals" className="gap-1.5">
              <FileText className="h-4 w-4" /> Proposals
            </TabsTrigger>
            <TabsTrigger value="invoices" className="gap-1.5">
              <Receipt className="h-4 w-4" /> Invoices
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5">
              <CreditCard className="h-4 w-4" /> Payments
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proposals">
            <PortalProposals session={session} />
          </TabsContent>
          <TabsContent value="invoices">
            <PortalInvoices session={session} />
          </TabsContent>
          <TabsContent value="payments">
            <PortalPayments session={session} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
