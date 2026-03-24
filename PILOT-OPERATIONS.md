# CoreFlow OS — Pilot Operations Readiness

> Generated: 2026-03-24 | Status: Controlled pilot ready

---

## 1. Pilot Launch Checklist

### A. Admin Onboarding Flow

| Step | Route / Action | Verified |
|------|----------------|----------|
| Sign up with email + password | `/login` (sign-up mode) | ✅ |
| Email verification required before sign-in | Auth config (no auto-confirm) | ✅ |
| Workspace auto-bootstrapped on first login | `bootstrap_workspace` RPC | ✅ |
| Dashboard onboarding checklist appears | `/dashboard` → `OnboardingChecklist` | ✅ |
| Checklist guides: company → contact → lead → proposal → invoice → portal → team | 8-step guided flow | ✅ |
| Admin sees all sidebar sections (Revenue, Spend, Workspace) | `AppSidebar` filters by role | ✅ |
| Settings page accessible for profile + workspace config | `/settings` | ✅ |

### B. Team Member Onboarding Flow

| Step | Verified |
|------|----------|
| Admin creates invite from `/team` page | ✅ |
| `create_workspace_invite` RPC enforces admin-only, email validation | ✅ |
| Invite email sent via `send-email` edge function (if RESEND_API_KEY configured) | ✅ |
| Invite link → `/invite?token=...` → shows accept/decline UI | ✅ |
| Email mismatch blocked with clear message | ✅ |
| Unauthenticated users redirected to login with return URL | ✅ |
| `accept_invite_by_token` creates membership atomically | ✅ |
| Duplicate membership handled gracefully | ✅ |
| Team member sees filtered sidebar (no Revenue/Spend/Workspace admin pages) | ✅ |

### C. Portal / Client Onboarding Flow

| Step | Verified |
|------|----------|
| Admin generates portal token from company detail page | ✅ (`generate_portal_token` RPC) |
| Token validated server-side via `validate_portal_token` RPC | ✅ |
| Portal entry at `/portal/*` — no auth required (token-based) | ✅ |
| Portal dashboard shows overview, invoices, proposals, documents, onboarding | ✅ |
| Client tasks assignable per company with ordered intake flow | ✅ |
| Portal tokens expire (configurable 1-365 days) | ✅ |
| Revoked/expired tokens rejected cleanly | ✅ |

### D. File Flow

| Step | Verified |
|------|----------|
| Upload via `file-gateway` edge function with signed URLs | ✅ |
| Authorization: project files → project membership or admin | ✅ |
| Authorization: company files → company access or admin | ✅ |
| File deletion restricted to admin role | ✅ |
| Stale files purged by cleanup worker after 30-day soft-delete | ✅ |

### E. Payment Flow

| Step | Verified |
|------|----------|
| Record payment against invoice via `/payments` | ✅ |
| Invoice status auto-transitions: issued → partially_paid → paid | ✅ |
| Payment proof upload supported | ✅ |
| Portal clients can view their invoice status | ✅ |

### F. Renewal Flow

| Step | Verified |
|------|----------|
| Create/update renewals via `manage_renewal` RPC | ✅ |
| Auto-generate invoices via `generate_due_renewal_invoices` (scheduled) | ✅ |
| Manual generation via `generate_renewal_invoice` (admin) | ✅ |
| Renewal auto-advances billing date after invoice paid | ✅ |
| Idempotency: duplicate generation for same cycle prevented | ✅ |

### G. Commercial Spine: Lead → Invoice

| Step | Verified |
|------|----------|
| Create lead from `/leads` | ✅ |
| Create proposal linked to lead + company | ✅ |
| Approve proposal (direct status transition by admin) | ✅ |
| Create project from approved proposal (`create_project_from_approved_version`) | ✅ |
| Line items auto-transferred as project tasks | ✅ |
| Create/issue invoice with atomic `issue_invoice` RPC | ✅ |

### H. Rollback / Incident Checklist

| Scenario | Action |
|----------|--------|
| Bad migration deployed | Revert to previous Lovable version (code + schema rollback) |
| Worker stuck failing | Check `/ops` → Worker Runs table; failure alerts auto-notify admins |
| Email delivery broken | Check `/email-health` → config status + logs; verify RESEND_API_KEY |
| Portal access broken | Check portal token status; verify `PORTAL_JWT_SECRET` in vault |
| Data corruption suspected | Query audit_logs for recent changes; soft-delete protects most entities |
| Invite flow broken | Check `/email-health` → send test invite; verify token resolution |
| Cleanup ran too aggressively | Review `/ops` → Latest Cleanup Summary; check retention thresholds |

---

## 2. Operational Visibility

### Admin Surfaces

| Surface | Route | What It Shows |
|---------|-------|---------------|
| **Ops / System Health** | `/ops` | Worker runs (success/fail/duration), manual cleanup controls, cleanup summary, digest runs, email logs |
| **Email Health** | `/email-health` | Email config status (4 secrets), smoke test for invites + portal, email delivery logs |
| **Digest Inspector** | `/digest-inspector` | Digest controls (preview/run), run history, digest notifications, system alerts, short links |
| **Audit Log** | `/audit` | All entity mutations with actor, timestamp, before/after metadata |
| **Notifications** | `/notifications` | Prioritized notifications (critical → warning → info), unread first |

### What Admins Can Quickly See

| Question | Where to Look |
|----------|---------------|
| Are workers failing? | `/ops` → Worker Runs table (status column, error column) |
| Are emails failing? | `/email-health` → Recent Email Logs (status badges) |
| Are invites/portal links broken? | `/email-health` → smoke test; `/ops` → email logs |
| Are there stuck operational states? | `/ops` → worker runs with "failed" status; `/digest-inspector` → system alerts |
| What changed recently? | `/audit` → chronological entity mutation log |
| Worker failure notifications | Auto-generated via `create_worker_failure_alert` after 2+ consecutive failures |

### Gap Assessment

| Area | Status |
|------|--------|
| Worker failure alerting | ✅ Automated (2+ failures → notification, 3+ → critical) |
| Email delivery visibility | ✅ Email logs + config check + smoke test |
| Portal token lifecycle | ✅ Token generation, consumption, expiry, revocation all tracked |
| Cleanup operations | ✅ Preview before run, cooldown, summary after |
| Audit trail | ✅ All major entity mutations logged |
| **Missing: uptime monitoring** | ⚠️ No external uptime check — rely on Lovable hosting SLA for pilot |

---

## 3. Backup / Restore / Migration Discipline

### Current State

- **No migration-readiness pack exists in the repository.** The architecture memory references one, but it was never committed as a file. For pilot scale this is acceptable — the Lovable Cloud infrastructure handles hosting and backups.
- **Supabase project ref**: Managed by Lovable Cloud (no external Supabase account needed).
- **Vault secrets required for production**: `PORTAL_JWT_SECRET`, `WORKER_SECRET`, `WORKER_AUTH_KEY`, `RESEND_API_KEY`, `APP_BASE_URL`, `SENDER_EMAIL`, `SENDER_NAME`, `SUPABASE_FUNCTIONS_URL`.

### What's Safe

- All entities use soft-delete (`deleted_at` column) — accidental deletes are recoverable
- Audit logs capture before/after state of all mutations
- Operational logs have tiered retention (30/90/180 days) — not lost prematurely
- Invoice numbers are gapless via `invoice_sequences` — no numbering corruption risk

### What's Operationally Dangerous

| Risk | Mitigation |
|------|------------|
| Vault secret rotation | Must be done via Lovable Cloud settings; coordinate `WORKER_SECRET` ↔ `WORKER_AUTH_KEY` |
| Schema migration failure on publish | Revert to previous Lovable version |
| Data loss in Live | No automated backups beyond Lovable's infrastructure — pilot data volume is small enough to manually export if needed |

---

## 4. Release / Rollout Sanity Checks

| Check | Status |
|-------|--------|
| `.env` not committed (only `.env.example`) | ✅ |
| `.env.example` documents required vars | ✅ |
| All 13 admin-only routes wrapped in `<AdminGuard>` | ✅ |
| Sidebar hides admin items for team members | ✅ |
| Email Health page shows clear config status | ✅ |
| Ops / Digest / Cleanup surfaces show real data, not misleading | ✅ |
| 404 catch-all route exists | ✅ |
| No dead-end routes (all nav items have valid targets) | ✅ |
| Login supports redirect param for invite flow | ✅ |
| Portal entry is public (no auth wall) | ✅ |
| CI runs typecheck + tests + build | ✅ |
| `strictNullChecks` enabled | ✅ |
| `issue_invoice` is atomic (RPC with rollback) | ✅ |
| `worker_runs` scoped by `workspace_id` | ✅ |
| Cleanup cooldown scoped by workspace | ✅ |
| Lead `owner_id` not overwritten on update | ✅ |
| Invocation helpers use vault-backed URLs | ✅ |
| `latest_proposal_versions` view (server-side deduplication) | ✅ |

---

## 5. Pilot Issue Triage Structure

### Severity Levels

| Level | Definition | Examples | Response |
|-------|-----------|----------|----------|
| **P0** | Data loss, security breach, or complete workflow blocker | RLS bypass, payment recorded against wrong invoice, auth broken, portal tokens exposed | Drop everything. Fix immediately. Communicate to affected users. |
| **P1** | Serious friction with a workaround available | Invoice PDF generation fails (can still view data), email delivery down (can share links manually), invite flow broken (can add members via SQL) | Fix within 24h. Document workaround for affected users. |
| **P2** | Polish, confusion, or cosmetic issues | Sidebar label unclear, date format inconsistent, empty state message unhelpful, mobile layout awkward | Track in beta feedback. Fix in next pass. |

### Daily Pilot Monitoring (Founder Checklist)

**Check these every morning during pilot:**

1. **`/ops`** — Scan Worker Runs table for any `failed` status in the last 24h
2. **`/email-health`** — Glance at Recent Email Logs for any `failed` entries
3. **`/notifications`** — Check for critical/warning notifications (worker failure alerts)
4. **`/audit`** — Skim for unexpected mutations or unfamiliar actors
5. **`/digest-inspector`** — Verify last digest run was `success` (if applicable)

**Weekly:**

6. Review beta feedback submissions at `/beta-feedback`
7. Run cleanup preview at `/ops` to check stale asset accumulation
8. Verify portal token usage via email-health portal contacts list

---

## 6. Environment / Config Reference

| Variable | Purpose | Where Set |
|----------|---------|-----------|
| `VITE_SUPABASE_URL` | Frontend API base | `.env` (auto-generated) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend anon key | `.env` (auto-generated) |
| `RESEND_API_KEY` | Email delivery | Lovable Cloud secrets |
| `APP_BASE_URL` | Link generation in emails | Lovable Cloud secrets |
| `SENDER_EMAIL` | From address for emails | Lovable Cloud secrets |
| `SENDER_NAME` | From name for emails | Lovable Cloud secrets |
| `PORTAL_JWT_SECRET` | Portal session signing | Vault (edge function access) |
| `WORKER_SECRET` | Scheduled worker auth | Lovable Cloud secrets |
| `WORKER_AUTH_KEY` | Vault copy of worker secret | Database vault |
| `SUPABASE_FUNCTIONS_URL` | Edge function base URL | Database vault |
