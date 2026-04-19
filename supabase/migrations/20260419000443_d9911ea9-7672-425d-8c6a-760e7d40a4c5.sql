DELETE FROM public.lender_readiness_verification_runs
WHERE scenario IN (
  'runway_critical_v3',
  'runway_healthy_positive_v3',
  'runway_tight_v3',
  'runway_insufficient_data_v3'
);