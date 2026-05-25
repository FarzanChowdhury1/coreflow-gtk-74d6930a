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

# Build a list of files (lexicographically sorted = chronological by name).
mapfile -t FILES < <(ls "$MIG_DIR"/*.sql 2>/dev/null | sort)

# Helper: return 0 if function $1 is redefined or dropped in any migration
# AFTER index $2 in FILES (i.e. superseded — older definitions are dead code).
function is_superseded() {
  local fname="$1" idx="$2" i
  for ((i=idx+1; i<${#FILES[@]}; i++)); do
    if grep -E -iq "(CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+FUNCTION[[:space:]]+(public\\.)?${fname}\\b|DROP[[:space:]]+FUNCTION[[:space:]]+(IF[[:space:]]+EXISTS[[:space:]]+)?(public\\.)?${fname}\\b)" "${FILES[$i]}"; then
      return 0
    fi
  done
  return 1
}

for idx in "${!FILES[@]}"; do
  f="${FILES[$idx]}"
  body="$(sed -E 's://.*$::; s/--.*$//' < "$f")"

  # 1) Hard-coded platform_admins INSERT.
  if echo "$body" | grep -E -iq "INSERT[[:space:]]+INTO[[:space:]]+(public\.)?platform_admins"; then
    BLOCKED+=("$f :: INSERT INTO platform_admins in migration")
    flagged=$((flagged + 1))
  fi

  # 2) auth.users WHERE email = '<literal>'.
  if echo "$body" | grep -E -iq "auth\.users[^;]*WHERE[^;]*email[[:space:]]*=[[:space:]]*'[^']+@"; then
    BLOCKED+=("$f :: auth.users WHERE email = '<literal>' in migration")
    flagged=$((flagged + 1))
  fi

  # 3) SECURITY DEFINER fn w/ _user_id arg, missing auth.uid() guard.
  if echo "$body" | grep -E -iq "SECURITY[[:space:]]+DEFINER" \
     && echo "$body" | grep -E -iq "_user_id[[:space:]]+uuid" \
     && echo "$body" | grep -E -iq "(public\.)?(notifications|messages|chats|notification_preferences)"; then
    if ! echo "$body" | grep -E -q "_user_id[[:space:]]*=[[:space:]]*auth\.uid\(\)" \
       && ! echo "$body" | grep -E -q "auth\.uid\(\)[[:space:]]*=[[:space:]]*_user_id"; then
      # Skip if the function defined here is later replaced/dropped (dead code).
      fname="$(echo "$body" | grep -E -io "CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+FUNCTION[[:space:]]+(public\.)?[a-zA-Z_][a-zA-Z0-9_]*" | head -1 | awk '{print $NF}' | sed -E 's/^public\.//')"
      if [ -n "$fname" ] && is_superseded "$fname" "$idx"; then
        continue
      fi
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
