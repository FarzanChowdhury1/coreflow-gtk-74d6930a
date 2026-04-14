
-- 1) Rename legacy pilot workspace
UPDATE public.workspaces
SET name = 'DARVIZ Labs (Pilot)', updated_at = now()
WHERE id = '3f9c83f5-ae12-4fa8-8fa0-105f0d9e06f6'
  AND deleted_at IS NULL;

-- 2) Soft-delete only truly empty bootstrap workspaces
UPDATE public.workspaces
SET deleted_at = now(), updated_at = now()
WHERE id IN (
  '14587c93-b0cc-4027-a8a4-d999d2e2bfaa',
  '1cb7105b-5a20-47f7-81e7-fcf94fa1eae6',
  '2209da37-85da-4417-9828-cba778827831',
  '36e30026-e12b-45ca-b525-8b3ff495d0c3',
  '4c381f4f-c77f-436f-8a12-241f32a1b07c',
  '8ac4f523-7877-426f-afc0-8ce0e42c7408',
  'a02d35aa-8fa2-48d3-b984-c00f273716dc',
  'ad1e59f4-7e55-4d4e-ae07-807128023e0a',
  'cbfc44b2-b46b-4231-9652-795db32a4539',
  'f494d8fa-481f-495a-b3e1-885b3f5fe6c9'
)
AND deleted_at IS NULL;
