import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import type { Tables } from "@/integrations/supabase/types";

const paymentSchema = z.object({
  invoice_id: z.string().uuid("Select an invoice"),
  amount: z.coerce.number().positive("Amount must be positive"),
  method: z.enum(["bank_transfer", "cash", "cheque", "mobile_banking", "other"]),
  reference: z.string().max(255).optional().or(z.literal("")),
  paid_at: z.string().min(1, "Payment date is required"),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  invoices: Tables<"invoices">[];
  preselectedInvoiceId?: string;
}

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  cheque: "Cheque",
  mobile_banking: "Mobile Banking (bKash/Nagad)",
  other: "Other",
};

export function PaymentFormDialog({ open, onOpenChange, onCreated, invoices, preselectedInvoiceId }: Props) {
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      invoice_id: preselectedInvoiceId || "",
      amount: 0,
      method: "bank_transfer",
      reference: "",
      paid_at: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const onSubmit = async (data: PaymentFormData) => {
    if (!currentWorkspace || !user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("payments").insert({
        workspace_id: currentWorkspace.id,
        invoice_id: data.invoice_id,
        amount: data.amount,
        method: data.method,
        reference: data.reference || null,
        paid_at: new Date(data.paid_at).toISOString(),
        recorded_by: user.id,
        notes: data.notes || null,
      });
      if (error) throw error;
      toast.success("Payment recorded");
      form.reset();
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Filter to only show invoices that can receive payments
  const payableInvoices = invoices.filter(
    (i) => i.status === "issued" || i.status === "partially_paid"
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="invoice_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Invoice *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select invoice" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {payableInvoices.map((inv) => (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.invoice_number} — ৳{(Number(inv.grand_total) - Number(inv.amount_paid)).toLocaleString("en-BD")} remaining
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (BDT) *</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step="0.01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Method *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(METHOD_LABELS).map(([val, label]) => (
                          <SelectItem key={val} value={val}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="paid_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference / TxID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. TRX-12345" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Recording…" : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
