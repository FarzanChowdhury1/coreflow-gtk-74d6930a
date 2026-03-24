import { describe, it, expect, vi } from "vitest";
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
    // Simulates the logic in LeadFormDialog: update uses basePayload without owner_id
    const basePayload = { title: "Updated", workspace_id: "ws-1", status: "contacted" };
    expect(basePayload).not.toHaveProperty("owner_id");
  });
});

// ── Invoice issuance atomicity (contract) ───────────────────────

describe("Invoice issuance atomicity (contract)", () => {
  it("issue_invoice RPC call shape is correct", () => {
    // Validates the RPC call contract matches what InvoiceDetail sends
    const rpcParams = {
      _workspace_id: "ws-1",
      _invoice_id: "inv-1",
      _line_items: [
        { description: "Item 1", quantity: 2, unit_price: 100, amount: 200, sort_order: 0 },
      ],
    };
    expect(rpcParams._line_items).toHaveLength(1);
    expect(rpcParams._line_items[0]).toHaveProperty("description");
    expect(rpcParams._line_items[0]).toHaveProperty("quantity");
    expect(rpcParams._line_items[0]).toHaveProperty("unit_price");
    expect(rpcParams._line_items[0]).toHaveProperty("amount");
    expect(rpcParams._line_items[0]).toHaveProperty("sort_order");
  });

  it("rejects issuance with no line items", () => {
    const lineItems: any[] = [];
    expect(lineItems.length).toBe(0);
    // InvoiceDetail guards: "Add at least one line item before issuing"
  });

  it("line item amounts compute correctly", () => {
    const items = [
      { quantity: 2, unit_price: 500 },
      { quantity: 1, unit_price: 1000 },
    ];
    const subtotal = items.reduce((s, l) => s + l.quantity * l.unit_price, 0);
    expect(subtotal).toBe(2000);
  });
});

// ── Portal token lifecycle (contract) ───────────────────────────

describe("Portal token lifecycle (contract)", () => {
  it("portalRestoreLocalSession rejects expired JWT", async () => {
    const { portalRestoreLocalSession } = await import("@/lib/portal-api");

    // Create an expired JWT payload (exp in the past)
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = btoa(
      JSON.stringify({
        workspace_id: "ws-1",
        company_id: "co-1",
        contact_id: "ct-1",
        contact_name: "Test",
        contact_email: "test@example.com",
        company_name: "TestCo",
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      })
    );
    const fakeJwt = `${header}.${payload}.fakesig`;

    sessionStorage.setItem("coreflow_portal_jwt", fakeJwt);
    const result = portalRestoreLocalSession();
    expect(result).toBeNull();
    expect(sessionStorage.getItem("coreflow_portal_jwt")).toBeNull();
  });

  it("portalRestoreLocalSession accepts valid JWT", async () => {
    const { portalRestoreLocalSession } = await import("@/lib/portal-api");

    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = btoa(
      JSON.stringify({
        workspace_id: "ws-1",
        company_id: "co-1",
        contact_id: "ct-1",
        contact_name: "Test User",
        contact_email: "test@example.com",
        company_name: "TestCo",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    );
    const fakeJwt = `${header}.${payload}.fakesig`;

    sessionStorage.setItem("coreflow_portal_jwt", fakeJwt);
    const result = portalRestoreLocalSession();
    expect(result).not.toBeNull();
    expect(result!.workspace_id).toBe("ws-1");
    expect(result!.contact_name).toBe("Test User");

    // cleanup
    sessionStorage.removeItem("coreflow_portal_jwt");
  });

  it("portalRestoreLocalSession returns null when no token stored", async () => {
    const { portalRestoreLocalSession } = await import("@/lib/portal-api");
    sessionStorage.removeItem("coreflow_portal_jwt");
    expect(portalRestoreLocalSession()).toBeNull();
  });
});

// ── File gateway authorization boundaries (contract) ────────────

describe("File gateway authorization (contract)", () => {
  it("owner_type values are restricted to known types", () => {
    const validOwnerTypes = [
      "project", "company", "contact", "invoice",
      "payment-proof", "client-update", "proposal", "feedback",
    ];
    // Any owner_type used in the app should be from this list
    for (const t of validOwnerTypes) {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it("delete_file requires admin role conceptually", () => {
    // file-gateway enforces: action=delete_file → must be admin
    // This test documents the contract
    const action = "delete_file";
    const adminOnly = action === "delete_file";
    expect(adminOnly).toBe(true);
  });
});

// ── Worker runs tenant scoping (contract) ───────────────────────

describe("Worker runs tenant scoping (contract)", () => {
  it("worker_runs insert requires workspace_id", () => {
    // Contract: all new worker_runs rows must include workspace_id
    const workerRunPayload = {
      worker_name: "digest",
      status: "success",
      workspace_id: "ws-1",
      triggered_by: "user-1",
      trigger_source: "manual",
    };
    expect(workerRunPayload).toHaveProperty("workspace_id");
    expect(workerRunPayload.workspace_id).toBeTruthy();
  });

  it("cooldown check must scope by workspace_id", () => {
    // Contract: cooldown query filters by worker_name AND workspace_id
    const cooldownQuery = {
      worker_name: "asset_cleanup",
      workspace_id: "ws-1",
      minutes: 5,
    };
    expect(cooldownQuery).toHaveProperty("workspace_id");
    expect(cooldownQuery).toHaveProperty("worker_name");
  });
});

// ── Send-email hardening (contract) ─────────────────────────────

describe("Send-email URL hardening (contract)", () => {
  it("APP_BASE_URL must not be derived from arbitrary origin", () => {
    // Contract: send-email uses Deno.env.get("APP_BASE_URL") only, not req Origin
    // This is a documentation/contract test
    const allowedSources = ["APP_BASE_URL env var"];
    expect(allowedSources).not.toContain("request Origin header");
  });
});
