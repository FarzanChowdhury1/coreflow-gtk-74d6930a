
-- 1. Platform admins table (separate from workspace roles)
CREATE TABLE public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Platform admins can see their own record
CREATE POLICY "Users can check own platform admin status"
  ON public.platform_admins FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- No insert/update/delete from client — managed via SQL/migrations only

-- 2. Security definer helper
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = _user_id
  );
$$;

-- 3. Extend beta_feedback with platform fields
ALTER TABLE public.beta_feedback
  ADD COLUMN IF NOT EXISTS current_route text,
  ADD COLUMN IF NOT EXISTS submitter_role text,
  ADD COLUMN IF NOT EXISTS founder_notes text;

-- 4. Platform admin can read ALL feedback cross-workspace
CREATE POLICY "Platform admins can view all feedback"
  ON public.beta_feedback FOR SELECT TO authenticated
  USING (is_platform_admin((SELECT auth.uid())));

-- 5. Platform admin can update status/notes on any feedback
CREATE POLICY "Platform admins can update any feedback"
  ON public.beta_feedback FOR UPDATE TO authenticated
  USING (is_platform_admin((SELECT auth.uid())));
