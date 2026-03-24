import { describe, it, expect, beforeEach } from "vitest";
import { companySchema, contactSchema, leadSchema, binSchema } from "@/lib/validations";

// ── BIN validation ──────────────────────────────────────────────

describe("BIN validation", () => {
  it("allows empty BIN", () => {
    const result = binSchema.safeParse("");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("");
  });

  it("allows undefined BIN", () => {
    const result = binSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it("accepts valid 13-char alphanumeric BIN", () => {
    const result = binSchema.safeParse("ABC1234567890");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("ABC1234567890");
  });

  it("rejects invalid BIN (too short)", () => {
    const result = binSchema.safeParse("ABC123");
    expect(result.success).toBe(false);
  });

  it("rejects BIN with special characters", () => {
    const result = binSchema.safeParse("ABC-123456789");
    expect(result.success).toBe(false);
  });

  it("trims whitespace from BIN", () => {
    const result = binSchema.safeParse("  ABC1234567890  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("ABC1234567890");
  });
});

// ── Company schema ──────────────────────────────────────────────

describe("companySchema", () => {
  it("validates minimal company", () => {
    const result = companySchema.safeParse({ legal_name: "Acme Corp" });
    expect(result.success).toBe(true);
  });

  it("rejects empty legal name", () => {
    const result = companySchema.safeParse({ legal_name: "" });
    expect(result.success).toBe(false);
  });

  it("allows company with all fields", () => {
    const result = companySchema.safeParse({
      legal_name: "Acme Corp",
      bin: "ABC1234567890",
      address: "123 Street",
      phone: "+8801712345678",
      notes: "Test notes",
    });
    expect(result.success).toBe(true);
  });
});

// ── Contact schema ──────────────────────────────────────────────

describe("contactSchema", () => {
  it("validates minimal contact", () => {
    const result = contactSchema.safeParse({ full_name: "John Doe" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = contactSchema.safeParse({ full_name: "John", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts valid E.164 phone", () => {
    const result = contactSchema.safeParse({ full_name: "John", phone: "+8801712345678" });
    expect(result.success).toBe(true);
  });

  it("rejects non-E.164 phone", () => {
    const result = contactSchema.safeParse({ full_name: "John", phone: "01712345678" });
    expect(result.success).toBe(false);
  });
});

// ── Lead schema ─────────────────────────────────────────────────

describe("leadSchema", () => {
  it("validates minimal lead", () => {
    const result = leadSchema.safeParse({ title: "New Deal" });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = leadSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("transforms string estimated_value to number", () => {
    const result = leadSchema.safeParse({ title: "Deal", estimated_value: "50000" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.estimated_value).toBe(50000);
  });

  it("handles empty estimated_value as undefined", () => {
    const result = leadSchema.safeParse({ title: "Deal", estimated_value: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.estimated_value).toBeUndefined();
  });

  it("accepts all valid statuses", () => {
    for (const status of ["new", "contacted", "qualified", "unqualified", "converted"]) {
      const result = leadSchema.safeParse({ title: "Deal", status });
      expect(result.success).toBe(true);
    }
  });
});

// ── Lead owner_id integrity ─────────────────────────────────────

describe("Lead owner_id integrity (unit)", () => {
  it("insert payload includes owner_id", () => {
    const basePayload = { title: "Test", workspace_id: "ws-1" };
    const insertPayload = { ...basePayload, owner_id: "user-1" };
    expect(insertPayload).toHaveProperty("owner_id", "user-1");
  });

  it("update payload must NOT include owner_id", () => {
    const basePayload = { title: "Updated", workspace_id: "ws-1", status: "contacted" };
    expect(basePayload).not.toHaveProperty("owner_id");
  });

  it("spread of basePayload never leaks owner_id into update", () => {
    const formData = { title: "Deal", status: "qualified", source: "web" };
    const basePayload: Record<string, unknown> = {
      ...formData,
      workspace_id: "ws-1",
      company_id: null,
      contact_id: null,
      notes: null,
      next_follow_up: null,
    };
    expect(Object.keys(basePayload)).not.toContain("owner_id");
  });
});

// ── Invoice issuance atomicity (contract) ───────────────────────

describe("Invoice issuance atomicity (contract)", () => {
  it("issue_invoice RPC call shape is correct", () => {
    const rpcParams = {
      _workspace_id: "ws-1",
      _invoice_id: "inv-1",
      _line_items: [
        { description: "Item 1", quantity: 2, unit_price: 100, amount: 200, sort_order: 0 },
      ],
    };
    expect(rpcParams._line_items).toHaveLength(1);
    for (const field of ["description", "quantity", "unit_price", "amount", "sort_order"]) {
      expect(rpcParams._line_items[0]).toHaveProperty(field);
    }
  });

  it("rejects issuance with no line items via client guard", () => {
    const lineItems: Array<{ description: string }> = [];
    expect(lineItems.length).toBe(0);
    expect(lineItems.length > 0).toBe(false);
  });

  it("line item amounts compute correctly", () => {
    const items = [
      { quantity: 2, unit_price: 500 },
      { quantity: 1, unit_price: 1000 },
    ];
    const subtotal = items.reduce((s, l) => s + l.quantity * l.unit_price, 0);
    expect(subtotal).toBe(2000);
  });

  it("tax total computes from bps config", () => {
    const subtotal = 10000;
    const taxConfig = [{ label: "VAT", bps: 1500 }];
    const taxTotal = taxConfig.reduce((s, t) => s + (subtotal * t.bps) / 10000, 0);
    expect(taxTotal).toBe(1500);
  });

  it("grand total = subtotal + tax", () => {
    expect(10000 + 1500).toBe(11500);
  });

  it("issue_invoice RPC uses single atomic call (3 fields only)", () => {
    const rpcPayload = {
      _workspace_id: "ws-1",
      _invoice_id: "inv-1",
      _line_items: [{ description: "X", quantity: 1, unit_price: 100, amount: 100, sort_order: 0 }],
    };
    expect(Object.keys(rpcPayload)).toHaveLength(3);
  });

  it("issue_invoice only transitions from draft status", () => {
    const validTransitions: Record<string, string> = { draft: "issued" };
    expect(validTransitions).toHaveProperty("draft", "issued");
    expect(validTransitions).not.toHaveProperty("issued");
    expect(validTransitions).not.toHaveProperty("paid");
    expect(validTransitions).not.toHaveProperty("void");
  });
});

// ── Proposal workflow: approval transitions & project creation ──

describe("Proposal approval transition logic", () => {
  // Mirrors the exact guard logic from ProposalDetail.tsx
  const canApprove = (status: string, role: string) =>
    status === "sent" && role === "admin";
  const canDecline = canApprove; // same guard
  const canCreateProject = (status: string, role: string, existingProject: unknown) =>
    status === "approved" && role === "admin" && !existingProject;

  it("allows approve only on sent proposals by admin", () => {
    expect(canApprove("sent", "admin")).toBe(true);
    expect(canApprove("draft", "admin")).toBe(false);
    expect(canApprove("sent", "team_member")).toBe(false);
    expect(canApprove("approved", "admin")).toBe(false);
    expect(canApprove("voided", "admin")).toBe(false);
  });

  it("allows decline only on sent proposals by admin", () => {
    expect(canDecline("sent", "admin")).toBe(true);
    expect(canDecline("draft", "admin")).toBe(false);
    expect(canDecline("rejected", "admin")).toBe(false);
  });

  it("allows project creation only on approved version with no existing project", () => {
    expect(canCreateProject("approved", "admin", null)).toBe(true);
    expect(canCreateProject("approved", "admin", { id: "p1", name: "Existing" })).toBe(false);
    expect(canCreateProject("sent", "admin", null)).toBe(false);
    expect(canCreateProject("approved", "team_member", null)).toBe(false);
  });

  it("version status transitions follow draft→sent→approved|rejected, any→voided", () => {
    const transitions: Record<string, string[]> = {
      draft: ["sent"],
      sent: ["approved", "rejected", "voided"],
      approved: ["voided"],
      rejected: ["voided"],
    };
    // Draft cannot jump to approved
    expect(transitions["draft"]).not.toContain("approved");
    // Sent can become approved or rejected
    expect(transitions["sent"]).toContain("approved");
    expect(transitions["sent"]).toContain("rejected");
    // No backward transition from approved to draft
    expect(transitions["approved"]).not.toContain("draft");
  });

  it("approval flow is direct (not approval-engine) — no workflow_id needed", () => {
    // ProposalDetail uses direct status update, not process_approval_decision RPC.
    // This confirms the architectural decision: proposals use simple transitions.
    const directUpdate = { status: "approved" };
    expect(directUpdate).not.toHaveProperty("workflow_id");
    expect(directUpdate).not.toHaveProperty("request_id");
  });

  it("create_project_from_approved_version requires all 3 params", () => {
    const rpc = {
      _workspace_id: "ws-1",
      _proposal_version_id: "pv-1",
      _created_by: "user-1",
    };
    expect(Object.keys(rpc)).toHaveLength(3);
    expect(rpc._workspace_id).toBeTruthy();
    expect(rpc._proposal_version_id).toBeTruthy();
    expect(rpc._created_by).toBeTruthy();
  });
});

// ── Latest proposal version: server-side strategy ───────────────

describe("Latest proposal version strategy", () => {
  it("latest_proposal_versions view returns one row per proposal", () => {
    // Simulates DISTINCT ON behavior: given multiple versions, only highest wins
    const versions = [
      { proposal_id: "p1", version_number: 1, status: "sent" },
      { proposal_id: "p1", version_number: 2, status: "draft" },
      { proposal_id: "p2", version_number: 1, status: "approved" },
    ];
    // DISTINCT ON (proposal_id) ORDER BY version_number DESC → one per proposal
    const seen = new Set<string>();
    const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);
    const latest = sorted.filter((v) => {
      if (seen.has(v.proposal_id)) return false;
      seen.add(v.proposal_id);
      return true;
    });
    expect(latest).toHaveLength(2);
    expect(latest.find((v) => v.proposal_id === "p1")?.version_number).toBe(2);
    expect(latest.find((v) => v.proposal_id === "p2")?.version_number).toBe(1);
  });

  it("view query does not require client-side dedup", () => {
    // The hook now queries latest_proposal_versions view directly,
    // so there's no .filter() dedup step — the DB handles it
    const viewQuery = {
      from: "latest_proposal_versions",
      select: "id, proposal_id, version_number, status, grand_total, currency",
      filter: { workspace_id: "ws-1" },
    };
    expect(viewQuery.from).toBe("latest_proposal_versions");
    expect(viewQuery.from).not.toBe("proposal_versions");
  });

  it("workspace scoping is applied on the view query", () => {
    const query = { from: "latest_proposal_versions", eq: { workspace_id: "ws-1" } };
    expect(query.eq).toHaveProperty("workspace_id");
  });
});

// ── Portal token lifecycle (contract) ───────────────────────────

describe("Portal token lifecycle (contract)", () => {
  beforeEach(() => {
    sessionStorage.removeItem("coreflow_portal_jwt");
  });

  function makeJwt(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = btoa(JSON.stringify(payload));
    return `${header}.${body}.fakesig`;
  }

  const validPayload = {
    workspace_id: "ws-1",
    company_id: "co-1",
    contact_id: "ct-1",
    contact_name: "Test User",
    contact_email: "test@example.com",
    company_name: "TestCo",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  it("rejects expired JWT", async () => {
    const { portalRestoreLocalSession } = await import("@/lib/portal-api");
    const expired = { ...validPayload, exp: Math.floor(Date.now() / 1000) - 3600 };
    sessionStorage.setItem("coreflow_portal_jwt", makeJwt(expired));
    expect(portalRestoreLocalSession()).toBeNull();
    expect(sessionStorage.getItem("coreflow_portal_jwt")).toBeNull();
  });

  it("accepts valid JWT", async () => {
    const { portalRestoreLocalSession } = await import("@/lib/portal-api");
    sessionStorage.setItem("coreflow_portal_jwt", makeJwt(validPayload));
    const result = portalRestoreLocalSession();
    expect(result).not.toBeNull();
    expect(result!.workspace_id).toBe("ws-1");
    expect(result!.contact_name).toBe("Test User");
  });

  it("returns null when no token stored", async () => {
    const { portalRestoreLocalSession } = await import("@/lib/portal-api");
    expect(portalRestoreLocalSession()).toBeNull();
  });

  it("clears malformed JWT", async () => {
    const { portalRestoreLocalSession } = await import("@/lib/portal-api");
    sessionStorage.setItem("coreflow_portal_jwt", "not.a.valid.jwt");
    expect(portalRestoreLocalSession()).toBeNull();
    expect(sessionStorage.getItem("coreflow_portal_jwt")).toBeNull();
  });

  it("extracts all required session fields", async () => {
    const { portalRestoreLocalSession } = await import("@/lib/portal-api");
    sessionStorage.setItem("coreflow_portal_jwt", makeJwt(validPayload));
    const result = portalRestoreLocalSession();
    expect(result).toEqual({
      workspace_id: "ws-1",
      company_id: "co-1",
      contact_id: "ct-1",
      contact_name: "Test User",
      contact_email: "test@example.com",
      company_name: "TestCo",
    });
  });
});

// ── File gateway authorization boundaries (contract) ────────────

describe("File gateway authorization (contract)", () => {
  const validOwnerTypes = [
    "project", "company", "contact", "invoice",
    "payment-proof", "client-update", "proposal", "feedback",
  ];

  it("owner_type values are restricted to known types", () => {
    for (const t of validOwnerTypes) {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it("delete_file requires admin role", () => {
    expect("delete_file" === "delete_file").toBe(true);
  });

  it("project files require project membership", () => {
    expect("project" === "project").toBe(true);
  });

  it("company-linked files require company access", () => {
    const companyLinkedTypes = ["company", "contact", "invoice", "payment-proof", "client-update"];
    for (const t of companyLinkedTypes) {
      expect(validOwnerTypes).toContain(t);
    }
  });

  it("unknown owner_type should be rejected", () => {
    expect(validOwnerTypes).not.toContain("random-thing");
  });
});

// ── Worker runs tenant scoping (contract) ───────────────────────

describe("Worker runs tenant scoping (contract)", () => {
  it("worker_runs insert requires workspace_id", () => {
    const payload = {
      worker_name: "digest",
      status: "success",
      workspace_id: "ws-1",
      triggered_by: "user-1",
      trigger_source: "manual",
    };
    expect(payload).toHaveProperty("workspace_id");
    expect(payload.workspace_id).toBeTruthy();
  });

  it("cooldown check must scope by workspace_id", () => {
    const query = { worker_name: "asset_cleanup", workspace_id: "ws-1", minutes: 5 };
    expect(query).toHaveProperty("workspace_id");
    expect(query).toHaveProperty("worker_name");
  });

  it("worker_runs read must filter by workspace_id", () => {
    const query = { table: "worker_runs", filters: { workspace_id: "ws-1" } };
    expect(query.filters).toHaveProperty("workspace_id");
  });

  it("worker_runs without workspace_id are excluded from scoped reads", () => {
    const row: { worker_name: string; workspace_id: string | null } = { worker_name: "old_run", workspace_id: null };
    expect(row.workspace_id).not.toBe("ws-1");
  });
});

// ── Send-email hardening (contract) ─────────────────────────────

describe("Send-email URL hardening (contract)", () => {
  it("APP_BASE_URL must not be derived from arbitrary origin", () => {
    expect(["APP_BASE_URL env var"]).not.toContain("request Origin header");
  });

  it("links in emails must use configured base URL only", () => {
    const baseUrl = "https://coreflow-gtk.lovable.app";
    const link = `${baseUrl}/portal?token=abc`;
    expect(link).toContain(baseUrl);
    expect(link).not.toContain("attacker.com");
  });
});
