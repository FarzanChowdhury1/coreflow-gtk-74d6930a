import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a monetary amount in BDT (CoreFlow is Bangladesh-only).
 * The `currency` parameter is accepted for call-site compatibility but ignored.
 */
export function formatCurrency(amount: number, _currency: string = "BDT"): string {
  return `৳${amount.toLocaleString()}`;
}
