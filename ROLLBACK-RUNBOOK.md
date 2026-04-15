# CoreFlow — Rollback & Migration Safety Runbook

## App Rollback

Lovable supports version-based rollback via the project history. To roll back:

1. Open the Lovable project editor
2. Click the version history panel
3. Select the last known-good version
4. Restore it

**Limitation**: This rolls back frontend code only. Database migrations are **not** reversed automatically.

---

## Edge Function Rollback

Edge Functions are deployed independently of the frontend. If a bad deploy happens:

1. **Identify the broken function** from Edge Function logs
2. **Roll back the app** to a version where the function code was correct
3. **Redeploy** the function from the restored code

Edge Functions that are deployed but not referenced in the current app version remain live. Always redeploy after rolling back app code.

**Critical functions** (do not rename or remove):
- `auth-email-hook` — auth email delivery
- `process-email-queue` — email queue dispatcher
- `portal-verify` — portal session creation
- `portal-data` — portal data API
- `file-gateway` — file upload/download

---

## Database Migration Safety

All migrations are forward-only. Lovable Cloud does not support automatic rollback of applied migrations.

### Migration Classification

| Migration | Type | Reversible? | Manual Rollback |
|---|---|---|---|
| `CREATE INDEX` | Additive | ✅ Yes | `DROP INDEX idx_name;` |
| `ADD COLUMN` | Additive | ✅ Yes | `ALTER TABLE t DROP COLUMN col;` |
| `CREATE TABLE` | Additive | ✅ Yes | `DROP TABLE t;` |
| `CREATE FUNCTION` / `CREATE TYPE` | Additive | ✅ Yes | `DROP FUNCTION` / `DROP TYPE` |
| `DROP COLUMN` | Destructive | ❌ No | Data is lost |
| `DROP TABLE` | Destructive | ❌ No | Data is lost |
| `ALTER COLUMN TYPE` | Destructive | ⚠️ Maybe | Depends on conversion |

### Recent Migrations Audit

| Migration | Operations | Reversible? |
|---|---|---|
| Performance indexes | `CREATE INDEX IF NOT EXISTS` × 8 | ✅ `DROP INDEX` |
| Expense payables | `ADD COLUMN payment_status`, `ADD COLUMN paid_date` | ✅ `DROP COLUMN` |
| Onboarding counts RPC | `CREATE FUNCTION get_onboarding_counts` | ✅ `DROP FUNCTION` |
| System alerts table | `CREATE TABLE system_alerts` + RLS policies | ✅ `DROP TABLE` |
| Dashboard metrics RPC | `CREATE FUNCTION get_dashboard_metrics` | ✅ `DROP FUNCTION` |

All recent migrations are additive and safely reversible.

### Pre-Migration Checklist

Before any destructive migration:

1. **Query Live** for existing data in affected columns/tables
2. **Back up data** if rows exist (e.g., copy to a `_backup` column)
3. **Confirm with team** before applying
4. **Never** run `DROP COLUMN` or `DROP TABLE` without the above steps

---

## Incident Response by Type

### 1. Bad Frontend Deploy
- **Detection**: Visual bugs, console errors, user reports
- **Response**: Roll back via Lovable version history (< 1 minute)
- **Risk**: None — frontend is stateless

### 2. Bad Edge Function Deploy
- **Detection**: Edge function logs show errors, features stop working
- **Response**: Roll back app code, redeploy function, verify via logs
- **Risk**: Low — functions are stateless; queue-based email system retries automatically

### 3. Bad Additive Migration (new table/column/index)
- **Detection**: App errors, unexpected data behavior
- **Response**: Apply corrective migration (`DROP INDEX`, `DROP TABLE`, etc.)
- **Risk**: Low — no data loss for additive changes

### 4. Bad Destructive Migration (dropped column/table)
- **Detection**: Missing data, broken queries
- **Response**: 
  - Check if Lovable Cloud has point-in-time recovery
  - Otherwise, restore from most recent backup
  - Apply corrective migration to recreate the schema
- **Risk**: HIGH — data may be permanently lost
- **Prevention**: Always query live data before destructive changes

### 5. Email Pipeline Failure
- **Detection**: `email_send_log` shows `dlq` entries, system alerts on dashboard
- **Response**: Check Edge Function logs for `process-email-queue`, verify cron job exists
- **Recovery**: Messages in DLQ need manual re-queuing or re-triggering

### 6. Auth System Failure
- **Detection**: Users cannot sign up/in, password reset fails
- **Response**: Check `auth-email-hook` logs, verify domain status in Cloud → Emails
- **Recovery**: If hook is broken, redeploy; if domain issue, check DNS

---

## What Remains Manual

- Database backups: rely on Lovable Cloud automatic daily backups
- Point-in-time recovery: depends on plan
- Service role key rotation: must be done in Cloud settings
- No automated migration rollback tooling — all rollbacks are manual SQL
- Edge Function log access: via Cloud → Edge Function Logs

---

## Related Documents

- [BACKUP-RESTORE-RUNBOOK.md](./BACKUP-RESTORE-RUNBOOK.md) — Full backup/restore procedures, RTO/RPO, recovery scenarios, pre-release checklists
- [PILOT-OPERATIONS.md](./PILOT-OPERATIONS.md) — Pilot launch checklists, daily monitoring, triage structure
