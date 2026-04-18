import { useState, useEffect, useRef } from "react";
import { Building2, Plus, Search, Link2, User, Calendar, Shield, Archive, RotateCcw, Download, ClipboardList, Upload, Activity, HeartPulse } from "lucide-react";
import { PaymentReliabilityDialog } from "@/components/clients/PaymentReliabilityDialog";
import { CompanyHealthDialog } from "@/components/clients/CompanyHealthDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { CompanyMobileCards } from "@/components/clients/CompanyMobileCards";
import { ContactMobileCards } from "@/components/clients/ContactMobileCards";
import { PageInfoButton } from "@/components/layout/PageInfoButton";
import { guardedExportToCSV, guardedExportToXLSX } from "@/lib/guarded-export";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { CompanyFormDialog } from "@/components/clients/CompanyFormDialog";
import { ContactFormDialog } from "@/components/clients/ContactFormDialog";
import { PortalLinkDialog } from "@/components/clients/PortalLinkDialog";
import { CompanyAccessDialog } from "@/components/clients/CompanyAccessDialog";
import { ClientOnboardingManager } from "@/components/clients/ClientOnboardingManager";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import { BulkImportDialog } from "@/components/clients/BulkImportDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Company = Tables<"companies">;
type Contact = Tables<"contacts">;

export default function Clients() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [portalLinkOpen, setPortalLinkOpen] = useState(false);
  const [meetingCompanyId, setMeetingCompanyId] = useState<string | null>(null);
  const [accessCompany, setAccessCompany] = useState<Company | null>(null);
  const [showArchivedCompanies, setShowArchivedCompanies] = useState(false);
  const [showArchivedContacts, setShowArchivedContacts] = useState(false);
  const [onboardingCompany, setOnboardingCompany] = useState<Company | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("companies");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [reliabilityCompany, setReliabilityCompany] = useState<Company | null>(null);
  const [healthCompany, setHealthCompany] = useState<Company | null>(null);
  const highlightRef = useRef<HTMLTableRowElement>(null);

  const workspaceId = currentWorkspace?.id;
  const isAdmin = currentRole === "admin";

  // Deep-link from search: ?highlight=<id>&tab=contacts
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hId = params.get("highlight");
    const tab = params.get("tab");
    if (hId) {
      setHighlightId(hId);
      if (tab) setActiveTab(tab);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const companiesPag = usePaginatedQuery<Company>({
    table: "companies",
    queryKey: ["companies", workspaceId ?? "", showArchivedCompanies ? "all" : "active"],
    workspaceId,
    filters: (q: any) => showArchivedCompanies ? q : q.is("deleted_at", null),
  });

  const contactsPag = usePaginatedQuery<Contact>({
    table: "contacts",
    queryKey: ["contacts", workspaceId ?? "", showArchivedContacts ? "all" : "active"],
    workspaceId,
    filters: (q: any) => showArchivedContacts ? q : q.is("deleted_at", null),
  });

  const companies = companiesPag.rows;
  const contacts = contactsPag.rows;
  const loadingCompanies = companiesPag.isLoading;
  const loadingContacts = contactsPag.isLoading;
  const clientsError = companiesPag.isError || contactsPag.isError;

  // Scroll to highlighted row when data loads
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = setTimeout(() => setHighlightId(null), 3000);
      return () => clearTimeout(t);
    }
  }, [highlightId, companies, contacts]);

  const activeCompanies = companies.filter((c) => !c.deleted_at);
  const archivedCompanies = companies.filter((c) => c.deleted_at);
  const activeContacts = contacts.filter((c) => !c.deleted_at);
  const archivedContacts = contacts.filter((c) => c.deleted_at);

  const displayCompanies = (showArchivedCompanies ? companies : activeCompanies).filter(
    (c) =>
      c.legal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.bin || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const displayContacts = (showArchivedContacts ? contacts : activeContacts).filter(
    (c) =>
      c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.email && c.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return <span className="italic text-muted-foreground/70">Independent</span>;
    return companies.find((c) => c.id === companyId)?.legal_name ?? "—";
  };

  const handleArchiveCompany = async (company: Company) => {
    const { error } = await supabase
      .from("companies")
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq("id", company.id);
    if (error) toast.error("Failed to archive company");
    else {
      toast.success("Company archived");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    }
  };

  const handleRestoreCompany = async (company: Company) => {
    const { error } = await supabase
      .from("companies")
      .update({ deleted_at: null } as any)
      .eq("id", company.id);
    if (error) toast.error("Failed to restore company");
    else {
      toast.success("Company restored");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    }
  };

  const handleArchiveContact = async (contact: Contact) => {
    const { error } = await supabase
      .from("contacts")
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq("id", contact.id);
    if (error) toast.error("Failed to archive contact");
    else {
      toast.success("Contact archived");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    }
  };

  const handleRestoreContact = async (contact: Contact) => {
    const { error } = await supabase
      .from("contacts")
      .update({ deleted_at: null } as any)
      .eq("id", contact.id);
    if (error) toast.error("Failed to restore contact");
    else {
      toast.success("Contact restored");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Clients</h1>
          <PageInfoButton
            title="Clients"
            description="Your external client companies and contacts. This is not internal team — those are managed under Internal Team."
            actions={["Add and manage client companies", "Add contacts linked to companies or independent", "Archive clients to preserve history", "Manage who on your team has access to each company"]}
            audience="Admins manage all clients. Team members see only clients they have access to."
            note="Contacts can exist without a company. Archived records are hidden from active views."
          />
        </div>
        {isAdmin && (() => {
            const companyCols = [
              { key: "legal_name", label: "Company Name" },
              { key: "phone", label: "Phone" },
              { key: "address", label: "Address" },
              { key: "bin", label: "BIN" },
              { key: "deleted_at", label: "Status", format: (v: any) => v ? "Archived" : "Active" },
              { key: "created_at", label: "Created", format: (v: any) => new Date(v).toLocaleDateString() },
            ];
            const contactData = displayContacts.map((c) => {
              const phones = Array.isArray((c as any).phones) ? (c as any).phones : [];
              const all = phones.length > 0
                ? phones.map((p: any) => `${p?.label ?? "other"}:${p?.number ?? ""}`).filter((s: string) => s.endsWith(":") === false).join(" | ")
                : [c.phone, (c as any).alt_phone].filter(Boolean).join(" | ");
              return {
                ...c,
                company_name: c.company_id ? companies.find((co) => co.id === c.company_id)?.legal_name ?? "—" : "Independent",
                all_phones: all,
              };
            });
            const contactCols = [
              { key: "full_name", label: "Name" },
              { key: "email", label: "Email" },
              { key: "phone", label: "Phone (Primary)" },
              { key: "all_phones", label: "All Phones" },
              { key: "designation", label: "Designation" },
              { key: "company_name", label: "Company" },
              { key: "deleted_at", label: "Status", format: (v: any) => v ? "Archived" : "Active" },
            ];
            return (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => currentWorkspace && guardedExportToCSV(currentWorkspace.id, displayCompanies, companyCols, "companies-export")}>
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => currentWorkspace && guardedExportToXLSX(currentWorkspace.id, displayCompanies, companyCols, "companies-export")}>
                  <Download className="h-4 w-4 mr-1" /> XLSX
                </Button>
                <Button variant="outline" size="sm" onClick={() => currentWorkspace && guardedExportToCSV(currentWorkspace.id, contactData, contactCols, "contacts-export")}>
                  <Download className="h-4 w-4 mr-1" /> Contacts CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => currentWorkspace && guardedExportToXLSX(currentWorkspace.id, contactData, contactCols, "contacts-export")}>
                  <Download className="h-4 w-4 mr-1" /> Contacts XLSX
                </Button>
                <Button variant="outline" size="sm" onClick={() => setBulkImportOpen(true)}>
                  <Upload className="h-4 w-4 mr-1" /> Import CSV
                </Button>
                <Button variant="outline" onClick={() => setPortalLinkOpen(true)}>
                  <Link2 className="mr-1 h-4 w-4" /> Client Portal Access
                </Button>
              </div>
            );
          })()}
      </div>
      <p className="mb-5 text-sm text-muted-foreground max-w-2xl">
        {isAdmin
          ? "Your external client companies and contacts. Archive records instead of deleting to preserve history. Contacts can exist independently or be linked to a company."
          : "Client companies and contacts you have access to. You can see clients you own, collaborate on, or are linked to through your projects."}
      </p>

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

      {clientsError && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <Building2 className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground">Failed to load client data. Try refreshing the page.</p>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="companies">Companies ({companiesPag.totalCount})</TabsTrigger>
            <TabsTrigger value="contacts">Contacts ({contactsPag.totalCount})</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="companies">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {isAdmin && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Switch checked={showArchivedCompanies} onCheckedChange={setShowArchivedCompanies} />
                Show archived
                {showArchivedCompanies && archivedCompanies.length > 0 && (
                  <span className="text-xs">({archivedCompanies.length})</span>
                )}
              </label>
            )}
            {isAdmin && (
              <Button size="sm" onClick={() => { setEditingCompany(null); setCompanyDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Add Company
              </Button>
            )}
          </div>
          {loadingCompanies ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
          ) : displayCompanies.length === 0 ? (
            <div className="rounded-lg border bg-card p-10 text-center">
              <Building2 className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <h2 className="text-sm font-medium text-foreground mb-1">
                {showArchivedCompanies ? "No companies found" : isAdmin ? "No active companies" : "No client companies available"}
              </h2>
              <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                {isAdmin
                  ? "Companies are your client organizations. Add one to start linking contacts, proposals, invoices, and projects."
                  : "You don't have access to any client companies yet. An admin can assign you as a relationship owner or collaborator."}
              </p>
              {isAdmin && !showArchivedCompanies && (
                <Button size="sm" onClick={() => { setEditingCompany(null); setCompanyDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Add First Company
                </Button>
              )}
            </div>
          ) : isMobile ? (
            <CompanyMobileCards
              companies={displayCompanies}
              isAdmin={isAdmin}
              onEdit={(c) => { setEditingCompany(c); setCompanyDialogOpen(true); }}
              onArchive={handleArchiveCompany}
              onRestore={handleRestoreCompany}
              onAccess={(c) => setAccessCompany(c)}
              onPortal={() => setPortalLinkOpen(true)}
              onMeeting={(id) => setMeetingCompanyId(id)}
              onOnboarding={(c) => setOnboardingCompany(c)}
            />
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Legal Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">BIN</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Address</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayCompanies.map((company) => {
                    const isArchived = !!company.deleted_at;
                    return (
                      <tr key={company.id} ref={highlightId === company.id ? highlightRef : undefined} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${isArchived ? "opacity-60" : ""} ${highlightId === company.id ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{company.legal_name}</span>
                            {isArchived && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{company.bin || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{company.address || "—"}</td>
                        <td className="px-4 py-3 text-right space-x-1">
                          {isAdmin && (
                            <>
                              {isArchived ? (
                                <Button variant="ghost" size="sm" onClick={() => handleRestoreCompany(company)}>
                                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                                </Button>
                              ) : (
                                <>
                                   <Button variant="ghost" size="sm" onClick={() => setAccessCompany(company)} title="Manage who can access this client">
                                     <Shield className="h-3.5 w-3.5 mr-1" /> Access
                                   </Button>
                                   <Button variant="ghost" size="sm" onClick={() => setOnboardingCompany(company)} title="Manage onboarding tasks">
                                     <ClipboardList className="h-3.5 w-3.5 mr-1" /> Onboarding
                                   </Button>
                                   <Button variant="ghost" size="sm" onClick={() => setMeetingCompanyId(company.id)}>
                                     <Calendar className="h-3.5 w-3.5 mr-1" /> Meet
                                   </Button>
                                   <Button variant="ghost" size="sm" onClick={() => setReliabilityCompany(company)} title="Payment reliability">
                                     <Activity className="h-3.5 w-3.5 mr-1" /> Reliability
                                   </Button>
                                   <Button variant="ghost" size="sm" onClick={() => setHealthCompany(company)} title="Financial health">
                                     <HeartPulse className="h-3.5 w-3.5 mr-1" /> Health
                                   </Button>
                                  <Button variant="ghost" size="sm" onClick={() => { setEditingCompany(company); setCompanyDialogOpen(true); }}>
                                    Edit
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={() => handleArchiveCompany(company)}
                                    title="Archive this company"
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <PaginationControls
            page={companiesPag.page}
            totalPages={companiesPag.totalPages}
            totalCount={companiesPag.totalCount}
            hasNext={companiesPag.hasNext}
            hasPrev={companiesPag.hasPrev}
            onNext={companiesPag.nextPage}
            onPrev={companiesPag.prevPage}
            isFetching={companiesPag.isFetching}
            pageSize={companiesPag.PAGE_SIZE}
          />
        </TabsContent>

        <TabsContent value="contacts">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {isAdmin && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Switch checked={showArchivedContacts} onCheckedChange={setShowArchivedContacts} />
                Show archived
                {showArchivedContacts && archivedContacts.length > 0 && (
                  <span className="text-xs">({archivedContacts.length})</span>
                )}
              </label>
            )}
            {isAdmin && (
              <Button size="sm" onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Add Contact
              </Button>
            )}
          </div>
          {loadingContacts ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
          ) : displayContacts.length === 0 ? (
            <div className="rounded-lg border bg-card p-10 text-center">
              <User className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <h2 className="text-sm font-medium text-foreground mb-1">
                {showArchivedContacts ? "No contacts found" : isAdmin ? "No active contacts" : "No contacts available"}
              </h2>
              <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                {isAdmin
                  ? "Contacts are people at your client companies or independent contacts. They can receive portal links and communications."
                  : "You don't have access to any contacts yet. Contacts are visible based on your access to their linked company."}
              </p>
              {isAdmin && !showArchivedContacts && (
                <Button size="sm" onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Add First Contact
                </Button>
              )}
            </div>
          ) : isMobile ? (
            <ContactMobileCards
              contacts={displayContacts}
              isAdmin={isAdmin}
              getCompanyName={getCompanyName}
              onEdit={(c) => { setEditingContact(c); setContactDialogOpen(true); }}
              onArchive={handleArchiveContact}
              onRestore={handleRestoreContact}
            />
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
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
                  {displayContacts.map((contact) => {
                    const isArchived = !!contact.deleted_at;
                    return (
                      <tr key={contact.id} ref={highlightId === contact.id ? highlightRef : undefined} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${isArchived ? "opacity-60" : ""} ${highlightId === contact.id ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{contact.full_name}</span>
                            {isArchived && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
                            {!isArchived && (contact as any).lifecycle_status && (contact as any).lifecycle_status !== "active" && (
                              <Badge variant="secondary" className="text-[10px]">
                                {(contact as any).lifecycle_status === "left_company" ? "Left Company" : (contact as any).lifecycle_status === "bounced" ? "Bounced" : "Inactive"}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{contact.email || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {(() => {
                            const phones = Array.isArray((contact as any).phones) ? (contact as any).phones : [];
                            const list = phones.length > 0
                              ? phones.map((p: any) => p?.number).filter(Boolean)
                              : [contact.phone, (contact as any).alt_phone].filter(Boolean);
                            if (list.length === 0) return "—";
                            if (list.length === 1) return list[0];
                            return (
                              <span title={list.join(", ")}>
                                {list[0]} <span className="text-[10px] text-muted-foreground/70">+{list.length - 1}</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{getCompanyName(contact.company_id)}</td>
                        <td className="px-4 py-3 text-right space-x-1">
                          {isAdmin && (
                            <>
                              {isArchived ? (
                                <Button variant="ghost" size="sm" onClick={() => handleRestoreContact(contact)}>
                                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => { setEditingContact(contact); setContactDialogOpen(true); }}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={() => handleArchiveContact(contact)}
                                    title="Archive this contact"
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <PaginationControls
            page={contactsPag.page}
            totalPages={contactsPag.totalPages}
            totalCount={contactsPag.totalCount}
            hasNext={contactsPag.hasNext}
            hasPrev={contactsPag.hasPrev}
            onNext={contactsPag.nextPage}
            onPrev={contactsPag.prevPage}
            isFetching={contactsPag.isFetching}
            pageSize={contactsPag.PAGE_SIZE}
          />
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
        companies={companies.filter((c) => !c.deleted_at)}
      />
      <PortalLinkDialog
        open={portalLinkOpen}
        onOpenChange={setPortalLinkOpen}
        contacts={activeContacts}
        companies={activeCompanies}
      />
      <CompanyAccessDialog
        open={!!accessCompany}
        onOpenChange={(open) => { if (!open) setAccessCompany(null); }}
        company={accessCompany}
      />
      <MeetingFormDialog
        open={!!meetingCompanyId}
        onOpenChange={(open) => { if (!open) setMeetingCompanyId(null); }}
        onSaved={() => setMeetingCompanyId(null)}
        defaultContext={meetingCompanyId ? { company_id: meetingCompanyId } : undefined}
      />
      {onboardingCompany && (
        <ClientOnboardingManager
          companyId={onboardingCompany.id}
          companyName={onboardingCompany.legal_name}
          open={!!onboardingCompany}
          onOpenChange={(open) => { if (!open) setOnboardingCompany(null); }}
        />
      )}
      <BulkImportDialog
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
        companies={companies}
        contacts={contacts}
      />
      <PaymentReliabilityDialog
        open={!!reliabilityCompany}
        onOpenChange={(o) => { if (!o) setReliabilityCompany(null); }}
        companyId={reliabilityCompany?.id ?? null}
        companyName={reliabilityCompany?.legal_name}
      />
      <CompanyHealthDialog
        open={!!healthCompany}
        onOpenChange={(o) => { if (!o) setHealthCompany(null); }}
        companyId={healthCompany?.id ?? null}
        companyName={healthCompany?.legal_name}
      />
    </div>
  );
}
