#!/usr/bin/env bash
# check-rpc-authz-safety.sh
#
# Flags SECURITY DEFINER functions that take a caller-controlled _user_id
# parameter and select from user-owned tables without comparing _user_id
# to auth.uid(). Also flags hard-coded INSERTs into platform_admins.
#
# Exit 0 on clean, 1 on any blocked pattern.

set -o pipefail
declare -a BLOCKED
flagged=0

MIG_DIR="supabase/migrations"
[ -d "$MIG_DIR" ] || { echo "OK — no migrations dir"; exit 0; }

for f in "$MIG_DIR"/*.sql; do
  [ -e "$f" ] || continue
  body="$(sed -E 's://.*$::; s/--.*$//' < "$f")"

  # 1) Hard-coded platform_admins INSERT.
  if echo "$body" | grep -E -iq "INSERT[[:space:]]+INTO[[:space:]]+(public\.)?platform_admins"; then
    BLOCKED+=("$f :: INSERT INTO platform_admins in migration")
    flagged=$((flagged + 1))
  fi

  # 2) auth.users WHERE email = '<literal>' (identity-specific seeds).
  if echo "$body" | grep -E -iq "auth\.users[^;]*WHERE[^;]*email[[:space:]]*=[[:space:]]*'[^']+@"; then
    BLOCKED+=("$f :: auth.users WHERE email = '<literal>' in migration")
    flagged=$((flagged + 1))
  fi

  # 3) SECURITY DEFINER functions w/ _user_id arg, missing auth.uid() guard.
  #    Heuristic: file declares SECURITY DEFINER + _user_id uuid arg and
  #    references notifications / messages / chats — must compare to auth.uid().
  if echo "$body" | grep -E -iq "SECURITY[[:space:]]+DEFINER" \
     && echo "$body" | grep -E -iq "_user_id[[:space:]]+uuid" \
     && echo "$body" | grep -E -iq "(public\.)?(notifications|messages|chats|notification_preferences)"; then
    if ! echo "$body" | grep -E -q "_user_id[[:space:]]*=[[:space:]]*auth\.uid\(\)" \
       && ! echo "$body" | grep -E -q "auth\.uid\(\)[[:space:]]*=[[:space:]]*_user_id"; then
      BLOCKED+=("$f :: SECURITY DEFINER fn with _user_id and no auth.uid() guard")
      flagged=$((flagged + 1))
    fi
  fi
done

echo "check-rpc-authz-safety: flagged=$flagged"
if [ ${#BLOCKED[@]} -gt 0 ]; then
  echo ""
  echo "BLOCKED — unsafe RPC authorization patterns:"
  for b in "${BLOCKED[@]}"; do echo "  ! $b"; done
  exit 1
fi
echo "OK — no unsafe RPC authorization patterns."
exit 0
