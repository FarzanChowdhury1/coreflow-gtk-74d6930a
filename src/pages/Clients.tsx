import { useState } from "react";
import { Building2, Plus, Search, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CompanyFormDialog } from "@/components/clients/CompanyFormDialog";
import { ContactFormDialog } from "@/components/clients/ContactFormDialog";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Tables } from "@/integrations/supabase/types";

type Company = Tables<"companies">;
type Contact = Tables<"contacts">;

export default function Clients() {
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const workspaceId = currentWorkspace?.id;

  const { data: companies = [], isLoading: loadingCompanies } = useQuery({
    queryKey: ["companies", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const { data: contacts = [], isLoading: loadingContacts } = useQuery({
    queryKey: ["contacts", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const filteredCompanies = companies.filter(
    (c) =>
      c.legal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.bin.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredContacts = contacts.filter(
    (c) =>
      c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.email && c.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return "—";
    return companies.find((c) => c.id === companyId)?.legal_name ?? "—";
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Client Directory</h1>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <Tabs defaultValue="companies">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="companies">Companies ({companies.length})</TabsTrigger>
            <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="companies">
          <div className="mb-4 flex justify-end">
            <Button size="sm" onClick={() => { setEditingCompany(null); setCompanyDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Company
            </Button>
          </div>
          {loadingCompanies ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
          ) : filteredCompanies.length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
              <p>No companies yet. Add your first client company.</p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Legal Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">BIN</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Address</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompanies.map((company) => (
                    <tr key={company.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{company.legal_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{company.bin}</td>
                      <td className="px-4 py-3 text-muted-foreground">{company.address || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEditingCompany(company); setCompanyDialogOpen(true); }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="contacts">
          <div className="mb-4 flex justify-end">
            <Button size="sm" onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Contact
            </Button>
          </div>
          {loadingContacts ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
          ) : filteredContacts.length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
              <p>No contacts yet. Add your first contact.</p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Phone</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Company</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.map((contact) => (
                    <tr key={contact.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{contact.full_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{contact.email || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{contact.phone || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{getCompanyName(contact.company_id)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEditingContact(contact); setContactDialogOpen(true); }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CompanyFormDialog
        open={companyDialogOpen}
        onOpenChange={setCompanyDialogOpen}
        company={editingCompany}
      />
      <ContactFormDialog
        open={contactDialogOpen}
        onOpenChange={setContactDialogOpen}
        contact={editingContact}
        companies={companies}
      />
    </div>
  );
}
