# CoreFlow — Rollback & Migration Safety Runbook

## App Rollback

Lovable supports version-based rollback via the project history. To roll back:

1. Open the Lovable project editor
2. Click the version history panel
3. Select the last known-good version
4. Restore it

**Limitation**: This rolls back frontend code only. Database migrations are **not** reversed automatically.

---

## Database Migration Safety

All migrations are forward-only. Supabase Cloud does not support automatic rollback of applied migrations.

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

| File | Operations | Reversible? |
|---|---|---|
| Indexes migration | `CREATE INDEX IF NOT EXISTS` × 5 | ✅ `DROP INDEX` |
| Expense payables | `ADD COLUMN payment_status`, `ADD COLUMN paid_date` | ✅ `DROP COLUMN` |
| Onboarding counts RPC | `CREATE FUNCTION get_onboarding_counts` | ✅ `DROP FUNCTION` |

All recent migrations are additive and safely reversible.

### Pre-Migration Checklist

Before any destructive migration:

1. **Query Live** for existing data in affected columns/tables
2. **Back up data** if rows exist (e.g., copy to a `_backup` column)
3. **Confirm with team** before applying
4. **Never** run `DROP COLUMN` or `DROP TABLE` without the above steps

### Incident Recovery Steps

1. **If a bad migration breaks the app**:
   - Roll back the frontend code to the previous version
   - Apply a corrective migration to reverse the schema change
   - Re-deploy

2. **If a bad migration loses data**:
   - Check if Supabase point-in-time recovery is available (depends on plan)
   - Otherwise, restore from most recent backup

3. **If an edge function fails**:
   - Redeploy the previous version of the function code
   - Check edge function logs for the error

---

## What Remains Manual

- Database backups: rely on Supabase automatic daily backups
- Point-in-time recovery: available on Pro plan and above
- Service role key rotation: must be done in Supabase dashboard
- No automated migration rollback tooling exists — all rollbacks are manual SQL
