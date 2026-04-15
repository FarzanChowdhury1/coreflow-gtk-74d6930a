# CoreFlow — Backup & Restore Runbook

> Last updated: 2026-04-15 | Classification: Internal Operations

---

## 1. System Inventory

| Layer | Technology | Managed By | Backup Responsibility |
|-------|-----------|------------|----------------------|
| **Frontend code** | React + Vite + TypeScript | Lovable (version history) + GitHub | Platform-managed |
| **Edge Functions** (14 functions) | Deno / Supabase Edge | Lovable deploy + GitHub | Platform-managed (code in repo) |
| **Database** (54 tables, 136 migrations) | PostgreSQL 15 via Lovable Cloud | Lovable Cloud infrastructure | Platform-managed daily backups |
| **Storage** (workspace-files bucket) | Supabase Storage (S3-backed) | Lovable Cloud infrastructure | Platform-managed |
| **Secrets** (8 runtime secrets) | Lovable Cloud Secrets + DB Vault | Owner-managed | Owner responsibility |
| **Auth config** | Supabase Auth (managed) | Lovable Cloud | Platform-managed |
| **Cron jobs** (5 scheduled jobs) | pg_cron | Lovable Cloud | Platform-managed |
| **DNS / Email domain** | coreflow.gatekeepr.live | Owner-managed (Cloudflare) | Owner responsibility |

---

## 2. What Is Backed Up Where

### Platform-Controlled (Lovable Cloud)

| Asset | Backup Method | Frequency | Retention |
|-------|--------------|-----------|-----------|
| Database (all tables + functions + triggers + RLS) | Automatic daily snapshots | Daily | Plan-dependent (typically 7 days) |
| Point-in-time recovery (WAL) | Continuous WAL archiving | Continuous | Plan-dependent |
| Storage objects (workspace-files bucket) | S3-backed redundancy | Continuous | Durable until deleted |
| Auth users + sessions | Part of database backup | Daily | Same as DB |
| Edge Function deployments | Deployed from repo on publish | On publish | Current version only (previous via git) |

### Owner-Controlled

| Asset | Where It Lives | Backup Method |
|-------|---------------|---------------|
| Source code (frontend + edge functions) | GitHub repository | Git history (permanent) |
| Migration SQL files (136 files) | `supabase/migrations/` in repo | Git history |
| Runtime secrets (`RESEND_API_KEY`, `WORKER_SECRET`, etc.) | Lovable Cloud Secrets UI | **Owner must document separately** |
| Vault secrets (`PORTAL_JWT_SECRET`, `WORKER_AUTH_KEY`, `SUPABASE_FUNCTIONS_URL`) | Database vault table | Included in DB backup, but values encrypted |
| DNS records (MX, DKIM, SPF for email domain) | Cloudflare dashboard | Owner must screenshot/export |
| Cloudflare Turnstile site key | Cloudflare dashboard | Owner must record |

### Not Backed Up / At Risk

| Asset | Risk Level | Notes |
|-------|-----------|-------|
| Runtime secret plaintext values | 🔴 HIGH | If lost from Lovable Cloud UI, must be re-created at source (Resend, etc.) |
| Edge Function logs | 🟡 MEDIUM | Ephemeral; not persisted beyond Cloud log viewer retention |
| Browser localStorage (user preferences) | 🟢 LOW | Non-critical; regenerated on use |

---

## 3. Recovery Scenarios

### Scenario A: Bad Frontend Deploy

| Attribute | Value |
|-----------|-------|
| **Detection** | Visual bugs, console errors, user reports |
| **RTO** | < 2 minutes |
| **RPO** | Zero data loss (frontend is stateless) |
| **Recovery Steps** | 1. Open Lovable editor → Version History panel<br>2. Select last known-good version<br>3. Restore → auto-publishes |
| **Verification** | Load published URL, confirm UI renders correctly |
| **Risk** | None — no data involved |

### Scenario B: Bad Edge Function Deploy

| Attribute | Value |
|-----------|-------|
| **Detection** | Edge Function logs show errors, portal/email/file features fail |
| **RTO** | < 10 minutes |
| **RPO** | Zero (functions are stateless; email queue retries automatically) |
| **Recovery Steps** | 1. Identify broken function from Edge Function Logs<br>2. Roll back app code to version with correct function source<br>3. Publish (auto-redeploys all edge functions)<br>4. Verify via Edge Function Logs |
| **Critical Functions** | `auth-email-hook`, `process-email-queue`, `portal-verify`, `portal-data`, `file-gateway` |
| **Warning** | Edge functions that were deployed but not in the rolled-back code remain live. Always republish after rollback. |

### Scenario C: Bad Additive Migration (new table/column/index/function)

| Attribute | Value |
|-----------|-------|
| **Detection** | App errors, unexpected query results |
| **RTO** | < 15 minutes |
| **RPO** | Zero (additive changes don't destroy existing data) |
| **Recovery Steps** | 1. Identify the problematic object<br>2. Apply corrective migration: `DROP INDEX`, `DROP TABLE`, `DROP FUNCTION`, `ALTER TABLE DROP COLUMN`<br>3. Roll back frontend if it depends on the new schema<br>4. Verify app loads and queries succeed |
| **Risk** | Low — no data loss for purely additive changes |

### Scenario D: Bad Destructive Migration (dropped column/table/altered type)

| Attribute | Value |
|-----------|-------|
| **Detection** | Missing data, broken queries, foreign key violations |
| **RTO** | Hours to days |
| **RPO** | **Potentially permanent data loss** |
| **Recovery Steps** | 1. **Stop**: Do not apply further migrations<br>2. Check Lovable Cloud for point-in-time recovery availability<br>3. If PITR available: restore to timestamp before the migration<br>4. If PITR unavailable: check daily backup; restore and replay non-destructive migrations<br>5. Recreate dropped schema objects via corrective migration<br>6. **Data in dropped columns/tables may be unrecoverable** |
| **Prevention** | See Pre-Release Backup Checklist below. **Never run destructive migrations without querying live data first.** |

### Scenario E: Email Pipeline Failure

| Attribute | Value |
|-----------|-------|
| **Detection** | `email_send_log` shows `dlq` status; system alerts on dashboard; users report missing emails |
| **RTO** | < 30 minutes |
| **RPO** | Emails in queue are preserved; DLQ entries need manual re-trigger |
| **Recovery Steps** | 1. Check Edge Function logs for `process-email-queue`<br>2. Verify `RESEND_API_KEY` is valid (check Resend dashboard)<br>3. Check `email_send_state` for `retry_after_until` (rate limit backoff)<br>4. If function crashed: redeploy via publish<br>5. Verify cron job `process_email_queue` exists and runs every minute |

### Scenario F: Auth System Failure

| Attribute | Value |
|-----------|-------|
| **Detection** | Users cannot sign up, log in, or reset passwords |
| **RTO** | < 30 minutes |
| **RPO** | Zero (auth state in DB, not lost) |
| **Recovery Steps** | 1. Check `auth-email-hook` Edge Function logs<br>2. Verify email domain DNS (MX, DKIM, SPF) at Cloudflare<br>3. If hook is broken: roll back and redeploy<br>4. If domain issue: check Lovable Cloud → Emails for domain status<br>5. Test: attempt password reset for a known account |

### Scenario G: Storage/File Loss

| Attribute | Value |
|-----------|-------|
| **Detection** | File downloads return 404; `files` table entries reference missing storage paths |
| **RTO** | Indeterminate — depends on cause |
| **RPO** | Platform-dependent (S3 durability is very high) |
| **Recovery Steps** | 1. Check if `files` record has `deleted_at` set (soft-deleted, not actually lost)<br>2. If storage object truly missing: check if cleanup worker ran prematurely<br>3. Contact Lovable support for storage-level recovery<br>4. Re-upload from client if original source available |
| **Note** | File metadata is in the DB backup; actual file blobs are in S3-backed storage with independent redundancy |

### Scenario H: Secret Loss or Rotation

| Attribute | Value |
|-----------|-------|
| **Detection** | Features fail silently; edge functions return auth errors |
| **RTO** | < 1 hour (if secret values documented externally) |
| **RPO** | Zero (secrets are config, not data) |
| **Recovery Steps** | 1. Identify which secret is missing/invalid from Edge Function logs<br>2. Obtain new value from source (Resend dashboard, generate new JWT secret, etc.)<br>3. Update via Lovable Cloud Secrets UI<br>4. For vault secrets: update via migration or direct SQL<br>5. Redeploy edge functions (publish) to pick up new values |
| **Critical Secrets** | `RESEND_API_KEY`, `WORKER_SECRET` ↔ `WORKER_AUTH_KEY` (must match), `PORTAL_JWT_SECRET`, `APP_BASE_URL`, `SENDER_EMAIL`, `SENDER_NAME`, `SUPABASE_FUNCTIONS_URL` |
| **Warning** | Rotating `PORTAL_JWT_SECRET` invalidates all active portal sessions. Rotating `WORKER_SECRET` without updating `WORKER_AUTH_KEY` breaks all scheduled workers. |

---

## 4. Pre-Release Backup Checklist

Run this checklist **before** any risky production change (destructive migration, major schema change, secret rotation):

- [ ] **Query affected tables** for existing data counts and samples
- [ ] **Export critical data** via Data Export (`/data-export`) if rows exist in affected tables
- [ ] **Confirm daily backup ran** within last 24h (Lovable Cloud → check backup status)
- [ ] **Note the current timestamp** (for PITR restoration reference)
- [ ] **Document current secret values** externally (if rotating secrets)
- [ ] **Verify GitHub is current** (all code committed and pushed)
- [ ] **Take note of current Lovable version** (for version-history rollback)
- [ ] **Communicate maintenance window** to active users if applicable
- [ ] **Review migration SQL** — classify as additive or destructive using the table in ROLLBACK-RUNBOOK.md

---

## 5. Post-Incident Restore Checklist

After any recovery action, verify these before declaring "restored":

- [ ] **App loads** at published URL without console errors
- [ ] **Auth works** — test login with a known account
- [ ] **Dashboard loads** — verify data appears (not empty due to broken queries)
- [ ] **Edge Functions respond** — test portal link, file download, or email health
- [ ] **Cron jobs exist** — check that 5 scheduled jobs are active (sweep_overdue_invoices, sweep_lead_followups, generate_due_renewal_invoices, process_email_queue, run_daily_digest)
- [ ] **RLS is intact** — verify a team_member cannot access admin-only routes/data
- [ ] **Email delivery works** — send a test invite or portal link
- [ ] **Audit log captures** — perform a mutation and verify it appears in `/audit`
- [ ] **No orphaned edge functions** — all 14 functions should be the correct version

---

## 6. RTO / RPO Summary

| Scenario | RTO (Time to Recover) | RPO (Data at Risk) |
|----------|----------------------|-------------------|
| Bad frontend deploy | < 2 min | None |
| Bad edge function deploy | < 10 min | None (queue retries) |
| Bad additive migration | < 15 min | None |
| Bad destructive migration | Hours–days | **Potentially permanent** |
| Email pipeline failure | < 30 min | Queued emails preserved |
| Auth system failure | < 30 min | None |
| Storage/file loss | Indeterminate | Platform-dependent |
| Secret loss | < 1 hr (if documented) | None (config only) |
| Full database loss | Hours | Up to 24h of data (daily backup interval) |

---

## 7. Known Gaps & Risks

| Gap | Severity | Mitigation |
|-----|----------|------------|
| No owner-controlled database backup export | 🔴 HIGH | Rely on Lovable Cloud daily backups + PITR. No way to independently export a full SQL dump today. |
| Secret plaintext not backed up externally | 🔴 HIGH | Owner must maintain a secure external record of all 8 secret values. Loss means re-creating at source. |
| No automated migration rollback | 🟡 MEDIUM | All rollbacks are manual SQL. Maintain the migration classification table in ROLLBACK-RUNBOOK.md. |
| Edge Function log retention unknown | 🟡 MEDIUM | Logs may expire. For critical debugging, capture relevant log excerpts in incident notes. |
| PITR availability plan-dependent | 🟡 MEDIUM | Verify Lovable Cloud plan includes PITR. If not, daily backup is the only restore point. |
| No external uptime monitoring | 🟡 MEDIUM | No automated alerting if the published site goes down. Consider adding a simple external ping monitor. |
| Cleanup worker could delete soft-deleted files | 🟢 LOW | 30-day retention window is generous. Cleanup preview available at `/ops`. |

---

## 8. Operational Contacts & Access

| Resource | Access Method |
|----------|-------------|
| Lovable Cloud (DB, Edge Functions, Secrets) | Lovable editor → Connectors → Lovable Cloud |
| GitHub repository | Connected via Lovable; direct access at GitHub |
| Cloudflare (DNS, Turnstile) | Owner's Cloudflare dashboard |
| Resend (email API) | Owner's Resend dashboard |
| Edge Function Logs | Lovable Cloud → Edge Function Logs |
| Published app | https://coreflow-gtk.lovable.app |

---

## 9. Related Documents

| Document | Purpose |
|----------|---------|
| `ROLLBACK-RUNBOOK.md` | Migration classification, rollback procedures, incident response by type |
| `PILOT-OPERATIONS.md` | Pilot launch checklists, daily monitoring, triage structure |
| `README.md` | Project overview and setup |
