import { z } from "zod";

// 13-digit alphanumeric BIN (Bangladesh Business Identification Number)
export const binSchema = z
  .string()
  .length(13, "BIN must be exactly 13 characters")
  .regex(/^[0-9A-Za-z]{13}$/, "BIN must be 13 alphanumeric characters");

// International phone: +[country code][number], 7-15 digits after +
// E.164: + followed by 6-15 digits (relaxed to accept shorter valid intl numbers)
export const internationalPhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{4,13}$/, "Phone must be in E.164 international format (e.g. +8801712345678)")
  .optional()
  .or(z.literal(""))
  .transform((v) => v || undefined);

export const companySchema = z.object({
  legal_name: z.string().trim().min(1, "Legal name is required").max(255),
  bin: binSchema,
  address: z.string().max(500).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const contactSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required").max(255),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: internationalPhoneSchema,
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
