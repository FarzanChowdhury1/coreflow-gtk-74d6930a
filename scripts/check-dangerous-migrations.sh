#!/usr/bin/env bash
# check-dangerous-migrations.sh
#
# Repo-level safety guard: scan supabase/migrations for destructive
# tenant-purge patterns that must never reappear in committed migrations.
#
# A migration is FLAGGED when it contains any of:
#   1. Hard-coded workspace UUID literals inside a DELETE statement
#      (e.g. DELETE FROM workspaces WHERE id IN ('xxxx-...','yyyy-...'))
#   2. Any `workspace_id IN ('<uuid-literal>'` pattern
#   3. DROP TRIGGER IF EXISTS trg_audit_workspaces co-located with a
#      tenant/workspace DELETE in the same file
#   4. DELETE FROM audit_logs that is NOT scoped via a local variable
#      (_ws / v_ws) or a self-seeded test-name prefix (e.g. fa-exact-path-%)
#
# A migration is ALLOWED (self-scaffolded cleanup) when its deletes are
# bound to a PL/pgSQL local variable like _ws / v_ws / v_<name> or
# clearly scoped to a test prefix and contains no hard-coded real
# tenant UUID literals.
#
# Exit 0 on clean, 1 on any blocked pattern.

set -o pipefail

MIG_DIR="supabase/migrations"

if [ ! -d "$MIG_DIR" ]; then
  echo "check-dangerous-migrations: $MIG_DIR not found"
  exit 0
fi

# UUID v4-ish literal regex
UUID_RE="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

scanned=0
flagged=0
allowlisted=0
declare -a BLOCKED
declare -a ALLOWED

strip_comments() {
  # Drop full-line "-- ..." comments and inline "-- ..." tails.
  # Block /* ... */ comments are rare in our migrations and tolerated.
  sed -E 's://.*$::; s/--.*$//'
}

for f in "$MIG_DIR"/*.sql; do
  [ -e "$f" ] || continue
  scanned=$((scanned + 1))

  body="$(strip_comments < "$f")"

  reasons=()

  # 1. Hard-coded UUID literal inside any DELETE statement line
  if echo "$body" | grep -E -i "DELETE[[:space:]]+FROM" | grep -E -q "'$UUID_RE'"; then
    reasons+=("hard-coded UUID literal in DELETE statement")
  fi

  # 2. workspace_id IN ('<uuid>' ...
  if echo "$body" | grep -E -iq "workspace_id[[:space:]]+IN[[:space:]]*\\([[:space:]]*'$UUID_RE'"; then
    reasons+=("workspace_id IN ('<uuid>',...) hard-coded tenant list")
  fi

  # 3. DELETE FROM workspaces / audit_logs with hard-coded UUID
  if echo "$body" | grep -E -iq "DELETE[[:space:]]+FROM[[:space:]]+(public\\.)?(workspaces|audit_logs)[^;]*'$UUID_RE'"; then
    reasons+=("DELETE FROM workspaces/audit_logs with hard-coded UUID")
  fi

  # 4. DROP TRIGGER trg_audit_workspaces + tenant DELETE in same file
  if echo "$body" | grep -E -iq "DROP[[:space:]]+TRIGGER[[:space:]]+IF[[:space:]]+EXISTS[[:space:]]+trg_audit_workspaces"; then
    if echo "$body" | grep -E -iq "DELETE[[:space:]]+FROM[[:space:]]+(public\\.)?(workspaces|audit_logs)"; then
      del_lines="$(echo "$body" | grep -E -i "DELETE[[:space:]]+FROM[[:space:]]+(public\\.)?(workspaces|audit_logs)")"
      bad="$(echo "$del_lines" | grep -E -v "(_ws|v_ws|v_[a-zA-Z_]+)" || true)"
      if [ -n "$bad" ]; then
        reasons+=("DROP trg_audit_workspaces co-located with unscoped tenant DELETE")
      fi
    fi
  fi

  # 5. DELETE FROM audit_logs not scoped to a local var or test prefix
  audit_dels="$(echo "$body" | grep -E -i "DELETE[[:space:]]+FROM[[:space:]]+(public\\.)?audit_logs" || true)"
  if [ -n "$audit_dels" ]; then
    bad="$(echo "$audit_dels" | grep -E -v "(_ws|v_ws|v_[a-zA-Z_]+|fa-exact-path-|LIKE[[:space:]]+')" || true)"
    if [ -n "$bad" ]; then
      reasons+=("DELETE FROM audit_logs without local-var/test-prefix scoping")
    fi
  fi

  # 6. DELETE FROM auth.users — allowed only if scoped to a local variable
  #    (_admin, v_admin, v_<name>). Bare/unscoped DELETE FROM auth.users blocked.
  authu_dels="$(echo "$body" | grep -E -i "DELETE[[:space:]]+FROM[[:space:]]+auth\\.users" || true)"
  if [ -n "$authu_dels" ]; then
    bad="$(echo "$authu_dels" | grep -E -v "(_admin|v_admin|v_[a-zA-Z_]+|_ws)" || true)"
    if [ -n "$bad" ]; then
      reasons+=("DELETE FROM auth.users not scoped to a local fixture variable")
    fi
  fi

  # 7. Workspace deletion/selection by non-unique name. Allowed only when
  #    the same file self-INSERTs that name (true self-scaffolded fixture)
  #    OR the predicate uses a well-known test prefix (fa-exact-path-%).
  if echo "$body" | grep -E -iq "FROM[[:space:]]+(public\\.)?workspaces[[:space:]]+WHERE[[:space:]]+name[[:space:]]*(=|LIKE)"; then
    has_self_insert="$(echo "$body" | grep -E -i "INSERT[[:space:]]+INTO[[:space:]]+(public\\.)?workspaces" || true)"
    is_known_prefix="$(echo "$body" | grep -E -iq "WHERE[[:space:]]+name[[:space:]]+LIKE[[:space:]]+'(fa-exact-path-|lr-verify-)" && echo y || true)"
    if [ -z "$has_self_insert" ] && [ -z "$is_known_prefix" ]; then
      reasons+=("workspace deletion/selection by non-unique name without self-scaffolded fixture")
    fi
  fi

  # 8. session_replication_role = 'replica' co-located with tenant DELETE
  if echo "$body" | grep -E -iq "session_replication_role[[:space:]]*=*[[:space:]]*'replica'"; then
    if echo "$body" | grep -E -iq "DELETE[[:space:]]+FROM[[:space:]]+(public\\.)?(workspaces|audit_logs|workspace_memberships|invoices|payments|expenses)"; then
      reasons+=("session_replication_role='replica' around tenant DELETE")
    fi
  fi

  # 9. Mass UPDATE workspaces SET deleted_at with hard-coded UUID literal(s)
  if echo "$body" | grep -E -iz "UPDATE[[:space:]]+(public\\.)?workspaces[[:space:]]+SET[[:space:]]+deleted_at" >/dev/null 2>&1; then
    if echo "$body" | grep -E -q "'$UUID_RE'"; then
      reasons+=("UPDATE workspaces SET deleted_at with hard-coded workspace UUID(s)")
    fi
  fi

  if [ ${#reasons[@]} -gt 0 ]; then
    flagged=$((flagged + 1))
    BLOCKED+=("$f :: ${reasons[*]}")
  else
    # Report self-scaffolded cleanup files as allowlisted for transparency
    if echo "$body" | grep -E -iq "DELETE[[:space:]]+FROM[[:space:]]+(public\\.)?(workspaces|audit_logs|workspace_memberships)"; then
      allowlisted=$((allowlisted + 1))
      reason="self-scaffolded cleanup (local var _ws/v_ws or test-prefix scoped)"
      if echo "$body" | grep -q "fa-exact-path-"; then
        reason="test-prefix scoped (fa-exact-path-%)"
      fi
      ALLOWED+=("$f :: $reason")
    fi
  fi
done

echo "check-dangerous-migrations: scanned=$scanned flagged=$flagged allowlisted=$allowlisted"
if [ ${#ALLOWED[@]} -gt 0 ]; then
  echo "Allowlisted (self-scaffolded test cleanup):"
  for a in "${ALLOWED[@]}"; do echo "  - $a"; done
fi

if [ ${#BLOCKED[@]} -gt 0 ]; then
  echo ""
  echo "BLOCKED — dangerous tenant-purge patterns detected:"
  for b in "${BLOCKED[@]}"; do echo "  ! $b"; done
  echo ""
  echo "Refusing commit. Rewrite or neutralize the offending migration(s)."
  exit 1
fi

echo "OK — no dangerous tenant-purge patterns found."
exit 0
