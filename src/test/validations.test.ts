import { describe, it, expect } from "vitest";
import { companySchema, contactSchema, leadSchema, binSchema } from "@/lib/validations";

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
});

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
