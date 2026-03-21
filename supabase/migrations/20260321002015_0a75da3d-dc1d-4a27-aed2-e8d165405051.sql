
-- VENDORS TABLE
CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  category text DEFAULT 'general',
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vendors_ws ON public.vendors(workspace_id, deleted_at);
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage vendors" ON public.vendors FOR ALL TO authenticated USING (has_workspace_role(auth.uid(), workspace_id, 'admin')) WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'));
CREATE POLICY "Members can view active vendors" ON public.vendors FOR SELECT TO authenticated USING (has_workspace_access(auth.uid(), workspace_id) AND deleted_at IS NULL);

-- EXPENSES TABLE
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BDT',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  category text DEFAULT 'general',
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  payment_method text DEFAULT 'bank_transfer',
  notes text,
  recorded_by uuid NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_ws ON public.expenses(workspace_id, deleted_at, expense_date);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage expenses" ON public.expenses FOR ALL TO authenticated USING (has_workspace_role(auth.uid(), workspace_id, 'admin')) WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'));

-- SUBSCRIPTIONS TABLE
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BDT',
  interval_months integer NOT NULL DEFAULT 1,
  next_billing_date date NOT NULL,
  category text DEFAULT 'software',
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_ws ON public.subscriptions(workspace_id, is_active);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage subscriptions" ON public.subscriptions FOR ALL TO authenticated USING (has_workspace_role(auth.uid(), workspace_id, 'admin')) WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'));

-- BUDGETS TABLE
CREATE TABLE public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  target_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BDT',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, category, period_start)
);
CREATE INDEX idx_budgets_ws ON public.budgets(workspace_id);
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage budgets" ON public.budgets FOR ALL TO authenticated USING (has_workspace_role(auth.uid(), workspace_id, 'admin')) WITH CHECK (has_workspace_role(auth.uid(), workspace_id, 'admin'));
