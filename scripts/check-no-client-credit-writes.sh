#!/usr/bin/env bash
# Fail the build if any client code path can move a credit balance again.
#
# This is the mechanical half of "there should be no way of setting a balance,
# no matter if guest or with account". Comments and design notes are worth
# something, but they do not stop the function coming back in six months when
# somebody needs a quick fix for a support ticket. This does.
#
# The balance is moved only by server-side functions no client can call:
# charge_scan, refund_scan, settle_scan, claim_free_match_for,
# claim_device_starter and grant_purchase_credits. If you need a new one, add
# it there, not here.
#
#   npm run check:credits
set -uo pipefail
cd "$(dirname "$0")/.."

FORBIDDEN=(
  'addLocalCredits'
  'setLocalCredits'
  'deductLocalCredits'
  'clearLocalCredits'
  'mergeLocalCreditsToAccount'
  'updateUserCredits'
  'deductCredits'
  'refundCredits'
  'grantCreditsForProduct'
  'grantGuestFreeCredits'
  'grantRegisteredFreeCredits'
)

fail=0
for name in "${FORBIDDEN[@]}"; do
  # Real call sites and imports only: a mention inside a comment explaining why
  # the thing is gone is exactly what we want to keep.
  hits=$(grep -rn --include='*.ts' --include='*.tsx' -E "(^|[^A-Za-z_.])${name}\s*\(|import[^;]*\b${name}\b" app lib 2>/dev/null \
         | grep -vE '^\s*[a-zA-Z/.]*:[0-9]+:\s*(//|\*|/\*)' || true)
  if [ -n "$hits" ]; then
    echo "FORBIDDEN: ${name} is back in the client."
    echo "$hits"
    fail=1
  fi
done

# The one that matters most: a direct write to the credits column.
direct=$(grep -rn --include='*.ts' --include='*.tsx' -E "from\('user_profiles'\)[[:space:]]*$|from\('user_profiles'\)\.(update|upsert|insert)" app lib 2>/dev/null || true)
if echo "$direct" | grep -qE '\.(update|upsert|insert)'; then
  echo "FORBIDDEN: a client write to user_profiles."
  echo "$direct"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: no client code path can set a credit balance."
fi
exit "$fail"
