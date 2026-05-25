#!/usr/bin/env bash
# check-xss-url-safety.sh
#
# Flags user-controlled URL values rendered directly into href={...}
# without going through a safe-URL allowlist (safeHttpUrl / normalizeHttpUrl).
#
# Exit 0 on clean, 1 on any blocked pattern.

set -o pipefail
declare -a BLOCKED
flagged=0

# 1) src/**: <a href={...response_link...}> without safeHttpUrl on same line
while IFS= read -r line; do
  # Skip lines that wrap response_link through safeHttpUrl already.
  if echo "$line" | grep -E -q "safeHttpUrl|normalizeHttpUrl"; then
    continue
  fi
  BLOCKED+=("$line")
  flagged=$((flagged + 1))
done < <(rg -n "href=\{[^}]*response_link[^}]*\}" src 2>/dev/null || true)

# 2) portal-data: response_link writes must use normalizeHttpUrl
if [ -f supabase/functions/portal-data/index.ts ]; then
  if grep -E -q "response_link" supabase/functions/portal-data/index.ts \
     && ! grep -E -q "normalizeHttpUrl" supabase/functions/portal-data/index.ts; then
    BLOCKED+=("supabase/functions/portal-data/index.ts :: response_link write without normalizeHttpUrl")
    flagged=$((flagged + 1))
  fi
fi

echo "check-xss-url-safety: flagged=$flagged"
if [ ${#BLOCKED[@]} -gt 0 ]; then
  echo ""
  echo "BLOCKED — unsafe user-controlled href / response_link writes:"
  for b in "${BLOCKED[@]}"; do echo "  ! $b"; done
  exit 1
fi
echo "OK — no unsafe href / response_link writes."
exit 0
