
-- 1. Fix short_links: drop broad member SELECT, restrict to admin-only
DROP POLICY IF EXISTS "Members can view short links" ON public.short_links;

-- 2. Fix renewals: NULL project_id should only be visible to admins
DROP POLICY IF EXISTS "Team members can view assigned project renewals" ON public.renewals;
CREATE POLICY "Team members can view assigned project renewals"
  ON public.renewals FOR SELECT TO authenticated
  USING (
    has_workspace_access((SELECT auth.uid()), workspace_id)
    AND project_id IS NOT NULL
    AND is_project_member((SELECT auth.uid()), project_id)
  );

-- 3. Fix search_path on enqueue_email and move_to_dlq
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$function$;

-- 4. Move pg_trgm to extensions schema
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
