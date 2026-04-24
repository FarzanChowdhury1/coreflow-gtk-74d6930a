
-- Make audit_trigger_fn self-aware: when the source table IS public.workspaces,
-- the workspace_id IS NEW.id / OLD.id (workspaces table has no workspace_id column).
-- Without this, any UPDATE on public.workspaces fails with:
--   record "new" has no field "workspace_id"

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _workspace_id UUID;
  _entity_id UUID;
  _actor_id UUID;
  _actor_name TEXT;
  _action TEXT;
  _meta JSONB;
BEGIN
  _actor_id := auth.uid();

  IF _actor_id IS NOT NULL THEN
    SELECT full_name INTO _actor_name FROM public.profiles WHERE user_id = _actor_id LIMIT 1;
  END IF;

  _action := lower(TG_OP);

  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'workspaces' THEN
      _workspace_id := OLD.id;
    ELSE
      _workspace_id := OLD.workspace_id;
    END IF;
    _entity_id := OLD.id;
    _meta := jsonb_build_object('old', to_jsonb(OLD));
  ELSIF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'workspaces' THEN
      _workspace_id := NEW.id;
    ELSE
      _workspace_id := NEW.workspace_id;
    END IF;
    _entity_id := NEW.id;
    _meta := jsonb_build_object('new', to_jsonb(NEW));
  ELSE
    IF TG_TABLE_NAME = 'workspaces' THEN
      _workspace_id := NEW.id;
    ELSE
      _workspace_id := NEW.workspace_id;
    END IF;
    _entity_id := NEW.id;
    _meta := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  END IF;

  INSERT INTO public.audit_logs (workspace_id, actor_id, actor_name, action, entity_type, entity_id, metadata)
  VALUES (_workspace_id, _actor_id, _actor_name, _action, TG_TABLE_NAME, _entity_id, _meta);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
