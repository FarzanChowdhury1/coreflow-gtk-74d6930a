
-- =============================================
-- 1. ADD reminder tracking columns
-- =============================================
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS grace_reminders_sent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_grace_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_grace_ends_at timestamptz;

-- =============================================
-- 2. FIX seat-capacity BEFORE-INSERT trigger
--    Allow the 11th seat (auto-promote handles it).
--    Only block when workspace is suspended.
-- =============================================
CREATE OR REPLACE FUNCTION public.check_workspace_seat_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _state text;
BEGIN
  _state := workspace_billing_state(NEW.workspace_id);
  IF _state = 'suspended' THEN
    RAISE EXCEPTION 'Workspace is suspended — activate a plan to add seats';
  END IF;
  -- Starter -> Growth happens on the 11th seat via auto_promote_at_threshold.
  -- We intentionally do NOT block here. Hard cap only applies above absurd values.
  RETURN NEW;
END;
$function$;

-- =============================================
-- 3. AUTO-PROMOTE on the 11th seat
--    Now also fires on pending invite inserts.
-- =============================================
CREATE OR REPLACE FUNCTION public.auto_promote_at_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _count int; _ws_id uuid; _state text;
BEGIN
  _ws_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
  _count := workspace_effective_seat_count(_ws_id);
  _state := workspace_billing_state(_ws_id);
  -- Promote whole workspace to Growth at the 11th effective seat.
  -- Trial/grace already have unlimited seats; promotion only matters for paid Starter.
  IF _count >= 11 AND _state = 'starter' THEN
    UPDATE workspaces
       SET plan = 'growth',
           seat_limit = 9999,
           pending_downgrade_to = NULL
     WHERE id = _ws_id AND plan = 'starter';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Add invite-side trigger (mirrors membership-side)
DROP TRIGGER IF EXISTS auto_promote_invite ON public.workspace_invites;
CREATE TRIGGER auto_promote_invite
  AFTER INSERT ON public.workspace_invites
  FOR EACH ROW EXECUTE FUNCTION public.auto_promote_at_threshold();

-- =============================================
-- 4. UPDATE billing-state to enforce paid renewal
--    After next_renewal_at passes:
--      - first 7 days = renewal grace (still active)
--      - after that  = suspended
-- =============================================
CREATE OR REPLACE FUNCTION public.workspace_billing_state(_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN w.deleted_at IS NOT NULL THEN 'suspended'
    -- Trial window
    WHEN w.trial_ends_at IS NOT NULL AND w.trial_ends_at > now()
         AND (w.grace_ends_at IS NULL OR w.grace_ends_at > now())
         AND w.next_renewal_at IS NULL
      THEN 'trial'
    -- Trial-end grace
    WHEN w.trial_ends_at IS NOT NULL AND w.trial_ends_at <= now()
         AND w.grace_ends_at IS NOT NULL AND w.grace_ends_at > now()
         AND w.next_renewal_at IS NULL
      THEN 'grace'
    WHEN w.trial_ends_at IS NOT NULL AND w.grace_ends_at IS NOT NULL
         AND w.grace_ends_at <= now() AND w.next_renewal_at IS NULL
      THEN 'suspended'
    -- Paid plan: renewal lapsed > 7 days ago = suspended
    WHEN w.next_renewal_at IS NOT NULL
         AND w.next_renewal_at + interval '7 days' <= now()
      THEN 'suspended'
    -- Paid plan in renewal grace
    WHEN w.next_renewal_at IS NOT NULL AND w.next_renewal_at <= now()
      THEN 'grace'
    WHEN w.plan = 'growth' THEN 'growth'
    ELSE 'starter'
  END
  FROM workspaces w WHERE w.id = _workspace_id;
$function$;

-- =============================================
-- 5. SCHEDULED-DOWNGRADE: apply at renewal
--    - target='starter': only if effective seats <= 10
--    - target='cancel' : suspend (deleted_at)
-- =============================================
CREATE OR REPLACE FUNCTION public.apply_pending_downgrades()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row record;
  _seats int;
  _applied int := 0;
  _blocked int := 0;
BEGIN
  FOR _row IN
    SELECT id, pending_downgrade_to, billing_cycle, next_renewal_at
      FROM workspaces
     WHERE pending_downgrade_to IS NOT NULL
       AND next_renewal_at IS NOT NULL
       AND next_renewal_at <= now()
       AND deleted_at IS NULL
  LOOP
    IF _row.pending_downgrade_to = 'cancel' THEN
      UPDATE workspaces
         SET deleted_at = now(),
             pending_downgrade_to = NULL
       WHERE id = _row.id;
      _applied := _applied + 1;
    ELSIF _row.pending_downgrade_to = 'starter' THEN
      _seats := workspace_effective_seat_count(_row.id);
      IF _seats <= 10 THEN
        UPDATE workspaces
           SET plan = 'starter',
               seat_limit = 10,
               pending_downgrade_to = NULL,
               next_renewal_at = CASE
                 WHEN _row.billing_cycle = 'annual' THEN now() + interval '12 months'
                 ELSE now() + interval '1 month'
               END
         WHERE id = _row.id;
        _applied := _applied + 1;
      ELSE
        -- Blocked: cannot downgrade to Starter while > 10 seats. Keep schedule pending; will retry next run.
        _blocked := _blocked + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('applied', _applied, 'blocked', _blocked);
END;
$function$;

-- =============================================
-- 6. GRACE REMINDERS (in-app only; email deferred)
--    During the 7-day trial-end grace, send up to 3
--    in-app notifications to workspace admins.
--    Spacing: at most one reminder per ~2 days.
-- =============================================
CREATE OR REPLACE FUNCTION public.send_grace_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ws record;
  _admin record;
  _next_index int;
  _days_left int;
  _sent int := 0;
BEGIN
  FOR _ws IN
    SELECT id, name, grace_ends_at, grace_reminders_sent, last_grace_reminder_at
      FROM workspaces
     WHERE deleted_at IS NULL
       AND trial_ends_at IS NOT NULL
       AND grace_ends_at IS NOT NULL
       AND trial_ends_at <= now()
       AND grace_ends_at > now()
       AND next_renewal_at IS NULL
       AND grace_reminders_sent < 3
       AND (last_grace_reminder_at IS NULL OR last_grace_reminder_at < now() - interval '36 hours')
  LOOP
    _next_index := _ws.grace_reminders_sent + 1;
    _days_left := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_ws.grace_ends_at - now())) / 86400.0))::int;

    FOR _admin IN
      SELECT user_id FROM workspace_memberships
       WHERE workspace_id = _ws.id AND role = 'admin'
    LOOP
      INSERT INTO notifications (workspace_id, user_id, title, body, severity, category, link)
      VALUES (
        _ws.id,
        _admin.user_id,
        'Activate your plan to keep ' || _ws.name || ' running',
        'Your trial ended. ' || _days_left || ' day(s) of grace remain. Activate Starter or Growth to avoid suspension.',
        CASE WHEN _next_index >= 3 THEN 'critical' ELSE 'warning' END,
        'billing',
        '/settings?tab=plan'
      );
    END LOOP;

    UPDATE workspaces
       SET grace_reminders_sent = _next_index,
           last_grace_reminder_at = now()
     WHERE id = _ws.id;
    _sent := _sent + 1;
  END LOOP;

  RETURN jsonb_build_object('workspaces_notified', _sent);
END;
$function$;

-- =============================================
-- 7. LEGACY helper rewrite (removes free/3-seat fallback)
-- =============================================
CREATE OR REPLACE FUNCTION public.check_workspace_seat_capacity(_workspace_id uuid, _include_pending_invites boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _state text; _count int;
BEGIN
  _state := workspace_billing_state(_workspace_id);
  IF _state = 'suspended' THEN RETURN false; END IF;
  -- Trial / grace / growth: effectively unlimited for the seat ladder.
  IF _state IN ('trial','grace','growth') THEN RETURN true; END IF;
  -- Starter paid: 11th seat allowed (auto-promotes); only refuse beyond a hard sanity ceiling.
  _count := workspace_effective_seat_count(_workspace_id);
  RETURN _count < 9999;
END;
$function$;

-- =============================================
-- 8. CRON: apply downgrades + reminders, hourly
-- =============================================
SELECT cron.unschedule('apply_pending_downgrades') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'apply_pending_downgrades'
);
SELECT cron.unschedule('send_grace_reminders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send_grace_reminders'
);

SELECT cron.schedule(
  'apply_pending_downgrades',
  '17 * * * *',
  $$ SELECT public.apply_pending_downgrades(); $$
);

SELECT cron.schedule(
  'send_grace_reminders',
  '23 * * * *',
  $$ SELECT public.send_grace_reminders(); $$
);
