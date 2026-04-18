import { z } from "zod";
import { isValidPhone } from "@/lib/phone";

// 13-digit alphanumeric BIN (Bangladesh Business Identification Number) — now optional
export const binSchema = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((v) => v?.trim() || "")
  .pipe(
    z.string().refine(
      (v) => v === "" || /^[0-9A-Za-z]{13}$/.test(v),
      "BIN must be exactly 13 alphanumeric characters"
    )
  );

// International phone — validated by libphonenumber-js (real per-country rules,
// not a generic regex). Empty is allowed (optional field).
export const internationalPhoneSchema = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v.trim() : ""))
  .refine(
    (v) => v === "" || isValidPhone(v),
    "Enter a valid phone number for the selected country"
  )
  .transform((v) => v || undefined);

// Structured multi-phone list for contacts.
export const contactPhoneSchema = z.object({
  label: z.enum(["primary", "alternate", "whatsapp", "office", "other"]),
  number: z.string().refine((v) => isValidPhone(v), "Invalid phone number"),
});
export const contactPhonesSchema = z.array(contactPhoneSchema).max(10, "Up to 10 phone numbers");

export const companySchema = z.object({
  legal_name: z.string().trim().min(1, "Legal name is required").max(255),
  bin: binSchema,
  address: z.string().max(500).optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const contactSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required").max(255),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: internationalPhoneSchema,
  alt_phone: internationalPhoneSchema,
  designation: z.string().max(255).optional().or(z.literal("")),
  company_id: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const leadSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
  status: z.enum(["new", "contacted", "qualified", "unqualified", "converted"]).default("new"),
  source: z.string().max(255).optional().or(z.literal("")),
  estimated_value: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === "" || v === undefined) return undefined;
      const n = Number(v);
      return isNaN(n) ? undefined : n;
    }),
  company_id: z.string().uuid().optional().or(z.literal("")),
  contact_id: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
  next_follow_up: z.string().optional().or(z.literal("")),
});

export type CompanyFormData = z.infer<typeof companySchema>;
export type ContactFormData = z.infer<typeof contactSchema>;
export type LeadFormData = z.infer<typeof leadSchema>;
