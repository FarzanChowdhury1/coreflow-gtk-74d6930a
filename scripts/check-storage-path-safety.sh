#!/usr/bin/env bash
# check-storage-path-safety.sh
#
# Repo-level safety guard for storage path handling.
#
# Flags service-role edge functions that delete from storage without a
# nearby workspace-prefix check, and branding helpers that compare
# storage.objects.name to workspace columns without binding the path
# to the workspace UUID prefix.
#
# Exit 0 on clean, 1 on any blocked pattern.

set -o pipefail

declare -a BLOCKED
flagged=0

# 1) Edge functions: service-role storage.from(...).remove([...]) without
#    a workspace-prefix guard in the same file.
if [ -d supabase/functions ]; then
  while IFS= read -r -d '' f; do
    # Must look like service-role context (uses SERVICE_ROLE_KEY).
    if ! grep -q "SUPABASE_SERVICE_ROLE_KEY" "$f"; then
      continue
    fi
    # Has .remove([ ... ]) on storage?
    if ! grep -E -q "storage\.from\(.*\)\.remove\(" "$f"; then
      continue
    fi
    # Must contain a workspace-prefix guard, or operate on self-created paths.
    if ! grep -E -q "startsWith\(\s*(\\$\{|\`)?workspaceId" "$f" \
       && ! grep -E -q "isPathOwnedByWorkspace" "$f" \
       && ! grep -E -q "created\.filePaths|self-scaffolded" "$f"; then
      BLOCKED+=("$f :: storage.remove without workspace-prefix guard")
      flagged=$((flagged + 1))
    fi
  done < <(find supabase/functions -type f \( -name "*.ts" -o -name "*.js" \) -print0)
fi

# 2) Branding RLS helpers that compare to workspace columns without prefix bind.
if [ -d supabase/migrations ]; then
  for f in supabase/migrations/*.sql; do
    [ -e "$f" ] || continue
    body="$(cat "$f")"
    if echo "$body" | grep -E -iq "is_workspace_branding_(readable|writable)"; then
      # The active definition must enforce a UUID-prefix regex on the object name.
      if echo "$body" | grep -E -iq "CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+FUNCTION[[:space:]]+public\\.is_workspace_branding_(readable|writable)"; then
        if ! echo "$body" | grep -E -q "\\[0-9a-f\\]\\{8\\}-\\[0-9a-f\\]\\{4\\}"; then
          # Tolerate the historical no-op stubs that only DROP/REVOKE.
          if echo "$body" | grep -E -iq "doc_logo_storage_path|portal_logo_storage_path"; then
            BLOCKED+=("$f :: branding helper without UUID-prefix bind")
            flagged=$((flagged + 1))
          fi
        fi
      fi
    fi
  done
fi

# 3) Block authenticated SELECT/UPDATE storage policies on workspace-files
#    that authorize using only files.storage_path + workspace membership.
if [ -d supabase/migrations ]; then
  for f in supabase/migrations/*.sql; do
    [ -e "$f" ] || continue
    while IFS= read -r stmt; do
      [ -z "$stmt" ] && continue
      echo "$stmt" | grep -E -iq "ON[[:space:]]+storage\.objects"  || continue
      echo "$stmt" | grep -E -iq "FOR[[:space:]]+(SELECT|UPDATE)"  || continue
      echo "$stmt" | grep -E -iq "'workspace-files'"               || continue
      echo "$stmt" | grep -E -iq "TO[[:space:]]+authenticated"     || continue
      if echo "$stmt" | grep -E -iq "public\.files" \
         && echo "$stmt" | grep -E -iq "workspace_memberships"; then
        BLOCKED+=("$f :: storage.objects SELECT/UPDATE on workspace-files via files.storage_path + workspace_memberships")
        flagged=$((flagged + 1))
      fi
    done < <(awk 'BEGIN{IGNORECASE=1; RS=";"} /CREATE[[:space:]]+POLICY/{print $0";"}' "$f")
  done
fi

echo "check-storage-path-safety: flagged=$flagged"
if [ ${#BLOCKED[@]} -gt 0 ]; then
  echo ""
  echo "BLOCKED — unsafe storage path patterns detected:"
  for b in "${BLOCKED[@]}"; do echo "  ! $b"; done
  exit 1
fi
echo "OK — storage path handling looks bound to workspace prefixes."
exit 0
