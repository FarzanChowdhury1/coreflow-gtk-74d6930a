DROP TRIGGER IF EXISTS trg_audit_paid_plan_activations ON public.paid_plan_activations;
CREATE TRIGGER trg_audit_paid_plan_activations
AFTER INSERT OR UPDATE OR DELETE ON public.paid_plan_activations
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_workspaces ON public.workspaces;
CREATE TRIGGER trg_audit_workspaces
AFTER INSERT OR UPDATE OR DELETE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();