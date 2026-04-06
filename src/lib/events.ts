/**
 * Lightweight product usage instrumentation.
 *
 * Tracks meaningful activation & module-usage events to the product_events table.
 * Fire-and-forget — never blocks UI.
 *
 * Event naming convention:  <entity>.<action>
 *   e.g. "workspace.created", "lead.first_created", "invoice.first_issued"
 */

import { supabase } from "@/integrations/supabase/client";

export type ProductEvent =
  | "workspace.created"
  | "workspace.sample_data_loaded"
  | "invite.sent"
  | "invite.accepted"
  | "lead.first_created"
  | "proposal.first_created"
  | "project.first_created"
  | "invoice.first_issued"
  | "payment.first_recorded"
  | "renewal.first_created"
  | "portal.first_token_created"
  | "vendor.first_created"
  | "expense.first_created"
  | "subscription.first_created"
  | "budget.first_created"
  | "meeting.first_created";

/**
 * Track a product event. Fire-and-forget — errors are silently swallowed.
 */
export function trackEvent(
  event: ProductEvent,
  workspaceId: string,
  userId: string,
  metadata?: Record<string, unknown>,
) {
  // Don't await — fire and forget
  supabase
    .from("product_events")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      event_name: event,
      metadata: metadata ?? {},
    } as any)
    .then(({ error }) => {
      if (error && import.meta.env.DEV) {
        console.warn("[events]", event, error.message);
      }
    });
}

/**
 * Check if an event has already been fired for this workspace.
 * Used to ensure "first_*" events are only tracked once.
 */
export async function hasEvent(
  event: ProductEvent,
  workspaceId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from("product_events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("event_name", event) as any;
  return (count ?? 0) > 0;
}

/**
 * Track a "first" event — only fires if it hasn't been recorded before.
 */
export async function trackFirstEvent(
  event: ProductEvent,
  workspaceId: string,
  userId: string,
  metadata?: Record<string, unknown>,
) {
  const already = await hasEvent(event, workspaceId);
  if (!already) {
    trackEvent(event, workspaceId, userId, metadata);
  }
}
