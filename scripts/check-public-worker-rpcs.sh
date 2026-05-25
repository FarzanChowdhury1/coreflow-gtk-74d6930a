#!/usr/bin/env bash
# check-public-worker-rpcs.sh
#
# Flags global, no-argument SECURITY DEFINER worker RPCs that mutate
# tenant/billing state without a worker/role guard at the body level.
#
# Required guard tokens (any one): require_internal_worker, service_role,
# auth.role(), is_platform_admin, current_user IN ('postgres'.

set -o pipefail

declare -a BLOCKED
flagged=0

if [ ! -d supabase/migrations ]; then
  echo "check-public-worker-rpcs: no migrations dir; OK"
  exit 0
fi

# Known billing/maintenance worker functions — must carry a guard.
WATCHED=(apply_pending_downgrades send_grace_reminders)

for fn in "${WATCHED[@]}"; do
  # Find the most recent migration that defines the function.
  latest=""
  for f in supabase/migrations/*.sql; do
    [ -e "$f" ] || continue
    if grep -E -iq "CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+FUNCTION[[:space:]]+public\\.${fn}\\(\\)" "$f"; then
      latest="$f"
    fi
  done
  if [ -z "$latest" ]; then
    continue
  fi
  body="$(cat "$latest")"
  if ! echo "$body" | grep -E -q "require_internal_worker|service_role|auth\\.role\\(\\)|is_platform_admin|current_user[[:space:]]+IN[[:space:]]*\\("; then
    BLOCKED+=("$latest :: ${fn} missing internal-worker guard")
    flagged=$((flagged + 1))
  fi
done

echo "check-public-worker-rpcs: flagged=$flagged"
if [ ${#BLOCKED[@]} -gt 0 ]; then
  echo ""
  echo "BLOCKED — public worker RPCs missing authorization guard:"
  for b in "${BLOCKED[@]}"; do echo "  ! $b"; done
  exit 1
fi
echo "OK — worker RPCs carry an internal-worker guard."
exit 0
