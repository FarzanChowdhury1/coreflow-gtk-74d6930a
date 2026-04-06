import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate the caller
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { workspace_id } = await req.json();
    if (!workspace_id) {
      return new Response(JSON.stringify({ error: "workspace_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Verify user is admin of this workspace
    const { data: membership } = await admin
      .from("workspace_memberships")
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", user.id)
      .single();

    if (!membership || membership.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if workspace already has data (companies exist = not empty)
    const { count } = await admin
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace_id)
      .is("deleted_at", null);

    if ((count ?? 0) > 0) {
      return new Response(JSON.stringify({ error: "Workspace already has data. Sample data can only be loaded into an empty workspace." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const today = now.split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
    const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString().split("T")[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const inFifteenDays = new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0];
    const inThirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString().split("T")[0];
    const inNinetyDays = new Date(Date.now() + 90 * 86400000).toISOString().split("T")[0];

    // --- COMPANIES ---
    const { data: companies } = await admin.from("companies").insert([
      { workspace_id, legal_name: "Meridian Creative Agency", bin: "MC-2024-001", phone: "+1 555-0100", address: "45 Design District, Suite 200, New York, NY 10011" },
      { workspace_id, legal_name: "Horizon Supply Co.", bin: "HS-2024-002", phone: "+1 555-0200", address: "780 Industrial Blvd, Chicago, IL 60614" },
      { workspace_id, legal_name: "Apex Digital Solutions", bin: "AD-2024-003", phone: "+1 555-0300", address: "12 Tech Park Way, Austin, TX 78701" },
    ]).select("id, legal_name");

    if (!companies || companies.length < 3) throw new Error("Failed to create companies");

    const [meridian, horizon, apex] = companies;

    // --- CONTACTS ---
    const { data: contacts } = await admin.from("contacts").insert([
      { workspace_id, company_id: meridian.id, full_name: "Sarah Chen", email: "sarah@meridiancreative.com", phone: "+1 555-0101", designation: "Managing Director" },
      { workspace_id, company_id: meridian.id, full_name: "James Park", email: "james@meridiancreative.com", phone: "+1 555-0102", designation: "Creative Lead" },
      { workspace_id, company_id: horizon.id, full_name: "Michael Torres", email: "michael@horizonsupply.com", phone: "+1 555-0201", designation: "Operations Manager" },
      { workspace_id, company_id: apex.id, full_name: "Priya Sharma", email: "priya@apexdigital.com", phone: "+1 555-0301", designation: "CTO" },
    ]).select("id, full_name, company_id");

    if (!contacts || contacts.length < 4) throw new Error("Failed to create contacts");

    const sarahId = contacts[0].id;
    const michaelId = contacts[2].id;
    const priyaId = contacts[3].id;

    // --- LEADS ---
    const { data: leads } = await admin.from("leads").insert([
      { workspace_id, title: "Brand refresh for Meridian", company_id: meridian.id, contact_id: sarahId, owner_id: user.id, status: "qualified", source: "referral", estimated_value: 15000, currency: "USD", last_contacted_at: `${sevenDaysAgo}T10:00:00Z`, next_follow_up: `${inFifteenDays}T10:00:00Z`, notes: "Sarah wants to refresh their brand identity. Looking at logo, color palette, and brand guidelines." },
      { workspace_id, title: "Supply chain dashboard for Horizon", company_id: horizon.id, contact_id: michaelId, owner_id: user.id, status: "new", source: "cold_outreach", estimated_value: 25000, currency: "USD", notes: "Initial conversation about building a real-time supply chain visibility tool." },
      { workspace_id, title: "Mobile app MVP for Apex", company_id: apex.id, contact_id: priyaId, owner_id: user.id, status: "proposal_sent", source: "website", estimated_value: 40000, currency: "USD", last_contacted_at: `${fifteenDaysAgo}T10:00:00Z` },
    ]).select("id, title");

    if (!leads || leads.length < 3) throw new Error("Failed to create leads");

    // --- PROPOSAL (for Meridian - the qualified lead) ---
    const { data: proposal } = await admin.from("proposals").insert({
      workspace_id,
      company_id: meridian.id,
      lead_id: leads[0].id,
      owner_id: user.id,
      title: "Brand Identity Refresh — Meridian Creative",
    }).select("id").single();

    if (!proposal) throw new Error("Failed to create proposal");

    const { data: version } = await admin.from("proposal_versions").insert({
      workspace_id,
      proposal_id: proposal.id,
      version_number: 1,
      status: "approved",
      currency: "USD",
      subtotal: 15000,
      tax_config: JSON.stringify([]),
      tax_total: 0,
      grand_total: 15000,
      valid_until: inThirtyDays,
      sent_at: `${fifteenDaysAgo}T10:00:00Z`,
    }).select("id").single();

    if (!version) throw new Error("Failed to create version");

    await admin.from("proposal_line_items").insert([
      { workspace_id, version_id: version.id, description: "Discovery & research phase", quantity: 1, unit_price: 3000, amount: 3000, sort_order: 0 },
      { workspace_id, version_id: version.id, description: "Logo design (3 concepts + refinement)", quantity: 1, unit_price: 5000, amount: 5000, sort_order: 1 },
      { workspace_id, version_id: version.id, description: "Brand guidelines document", quantity: 1, unit_price: 4000, amount: 4000, sort_order: 2 },
      { workspace_id, version_id: version.id, description: "Collateral templates (business cards, letterhead)", quantity: 1, unit_price: 3000, amount: 3000, sort_order: 3 },
    ]);

    // --- PROJECT (from approved proposal) ---
    const { data: project } = await admin.from("projects").insert({
      workspace_id,
      name: "Meridian Brand Refresh",
      company_id: meridian.id,
      proposal_version_id: version.id,
      status: "active",
      start_date: fifteenDaysAgo,
      target_end_date: inSixtyDays,
      description: "Full brand identity refresh including logo, guidelines, and collateral.",
    }).select("id").single();

    if (!project) throw new Error("Failed to create project");

    // Add current user as project member
    await admin.from("project_members").insert({
      workspace_id,
      project_id: project.id,
      user_id: user.id,
    });

    // --- CLIENT UPDATE ---
    await admin.from("client_updates").insert({
      workspace_id,
      project_id: project.id,
      company_id: meridian.id,
      author_id: user.id,
      title: "Discovery phase complete",
      body: "We've completed the initial research and competitive analysis. Moving into the concept design phase this week. Three logo directions will be ready for review by next Friday.",
      is_published: true,
      published_at: `${sevenDaysAgo}T14:00:00Z`,
    });

    // --- INVOICE ---
    // Get next invoice number
    const { data: seqData } = await admin.from("invoice_sequences").select("last_number").eq("workspace_id", workspace_id).single();
    let invoiceNum = 1;
    if (seqData) {
      invoiceNum = seqData.last_number + 1;
      await admin.from("invoice_sequences").update({ last_number: invoiceNum }).eq("workspace_id", workspace_id);
    } else {
      await admin.from("invoice_sequences").insert({ workspace_id, last_number: 1 });
    }

    const invoiceNumber = `INV-${String(invoiceNum).padStart(4, "0")}`;
    const { data: invoice } = await admin.from("invoices").insert({
      workspace_id,
      company_id: meridian.id,
      project_id: project.id,
      proposal_version_id: version.id,
      invoice_number: invoiceNumber,
      status: "sent",
      currency: "USD",
      subtotal: 8000,
      tax_config: JSON.stringify([]),
      tax_total: 0,
      grand_total: 8000,
      amount_paid: 8000,
      issue_date: fifteenDaysAgo,
      due_date: today,
      notes: "Phase 1 milestone: Discovery + initial concepts",
    }).select("id").single();

    if (!invoice) throw new Error("Failed to create invoice");

    await admin.from("invoice_line_items").insert([
      { workspace_id, invoice_id: invoice.id, description: "Discovery & research phase", quantity: 1, unit_price: 3000, amount: 3000, sort_order: 0 },
      { workspace_id, invoice_id: invoice.id, description: "Logo design (deposit — 3 concepts)", quantity: 1, unit_price: 5000, amount: 5000, sort_order: 1 },
    ]);

    // --- PAYMENT ---
    await admin.from("payments").insert({
      workspace_id,
      invoice_id: invoice.id,
      amount: 8000,
      method: "bank_transfer",
      reference: "TRF-20240115-MC",
      paid_at: `${sevenDaysAgo}T10:00:00Z`,
      recorded_by: user.id,
      notes: "Wire received for Phase 1",
    });

    // Update invoice status to paid
    await admin.from("invoices").update({ status: "paid", amount_paid: 8000 }).eq("id", invoice.id);

    // --- RENEWAL ---
    await admin.from("renewals").insert({
      workspace_id,
      company_id: meridian.id,
      project_id: project.id,
      label: "Brand guidelines annual update",
      amount: 3000,
      currency: "USD",
      interval_months: 12,
      next_billing_date: inNinetyDays,
      is_active: true,
      notes: "Annual update of brand guidelines and collateral templates.",
    });

    // --- MEETING ---
    await admin.from("meetings").insert({
      workspace_id,
      title: "Meridian concept review",
      company_id: meridian.id,
      contact_id: sarahId,
      project_id: project.id,
      created_by: user.id,
      starts_at: `${inFifteenDays}T14:00:00Z`,
      ends_at: `${inFifteenDays}T15:00:00Z`,
      meeting_type: "client",
      status: "scheduled",
      location: "Google Meet",
      description: "Review the 3 logo concepts with Sarah and James.",
    });

    // --- VENDOR ---
    const { data: vendor } = await admin.from("vendors").insert({
      workspace_id,
      name: "TypeForge Foundry",
      category: "design",
      contact_name: "Alex Rivera",
      contact_email: "alex@typeforge.io",
      notes: "Custom typography partner. Licensed their Meridian display typeface.",
    }).select("id").single();

    // --- EXPENSE ---
    if (vendor) {
      await admin.from("expenses").insert({
        workspace_id,
        description: "Meridian Display typeface license",
        amount: 450,
        currency: "USD",
        expense_date: thirtyDaysAgo,
        category: "design",
        vendor_id: vendor.id,
        project_id: project.id,
        payment_method: "credit_card",
        payment_status: "paid",
        paid_date: thirtyDaysAgo,
        recorded_by: user.id,
        notes: "Perpetual commercial license for brand project.",
      });
    }

    // --- SUBSCRIPTION ---
    await admin.from("subscriptions").insert({
      workspace_id,
      vendor_id: vendor?.id ?? null,
      label: "Figma Team Plan",
      amount: 45,
      currency: "USD",
      billing_cycle: "monthly",
      next_billing_date: inThirtyDays,
      status: "active",
      category: "software",
      notes: "Design tool subscription — shared team account.",
    });

    // --- BUDGET ---
    const periodStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
    const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
    const periodEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-${String(nextMonth.getDate()).padStart(2, "0")}`;

    await admin.from("budgets").insert([
      { workspace_id, category: "design", target_amount: 2000, currency: "USD", period_start: periodStart, period_end: periodEnd, notes: "Monthly design tools and assets budget." },
      { workspace_id, category: "software", target_amount: 500, currency: "USD", period_start: periodStart, period_end: periodEnd, notes: "SaaS subscriptions for the team." },
    ]);

    return new Response(JSON.stringify({ success: true, message: "Sample data loaded successfully." }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
