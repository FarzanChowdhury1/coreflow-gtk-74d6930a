-- Insert platform admin for nazrafnc@gmail.com (idempotent)
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'nazrafnc@gmail.com'
ON CONFLICT (user_id) DO NOTHING;