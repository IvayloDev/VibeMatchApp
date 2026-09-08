#!/usr/bin/env bash
#
# Simulate a first-ever install of TuneMatch on the iOS Simulator, so the next
# launch is a brand-new guest with the 1 free guest credit.
#
# Deleting the app is NOT enough on its own. Guest state is split in two:
#
#   AsyncStorage (app container)  - credits, guest match history, pro cache,
#                                   the pro daily-scan counter
#   SecureStore  (sim keychain)   - the device id, the "guest free credits
#                                   already granted" marker, the onboarding
#                                   flags and the once-per-device results
#                                   paywall flag
#
# lib/utils/freeCredits.ts deliberately keys the grant marker off a Keychain
# device id to stop people farming free credits by reinstalling, so the
# keychain has to be cleared too or the fresh install comes back with 0
# credits and skips onboarding.
#
# Usage:  ./scripts/reset-sim-fresh-install.sh [simulator-udid]
#
set -euo pipefail

BUNDLE_ID="com.paltech.tunematch"
UDID="${1:-D9EDC606-371E-45B1-9F2B-CA8DB251C7E9}"

if ! xcrun simctl list devices booted | grep -q "$UDID"; then
  echo "Simulator $UDID is not booted. Boot it first:"
  echo "  xcrun simctl boot $UDID"
  exit 1
fi

echo "==> Terminating $BUNDLE_ID"
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true

DATA_DIR="$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data 2>/dev/null || true)"
if [ -z "$DATA_DIR" ] || [ ! -d "$DATA_DIR" ]; then
  echo "!! Could not find the app data container - is the app installed?"
  exit 1
fi

echo "==> Clearing AsyncStorage (credits, guest history, pro cache, scan counter)"
rm -rf "$DATA_DIR/Library/Application Support/$BUNDLE_ID/RCTAsyncLocalStorage_V1"

echo "==> Clearing the RevenueCat cache (anonymous app user id, cached offerings)"
rm -rf "$DATA_DIR/Library/Application Support/revenuecat"

echo "==> Resetting the simulator keychain (SecureStore: device id, free-credit"
echo "    grant marker, onboarding flags, results paywall flag)"
xcrun simctl keychain "$UDID" reset

echo
echo "Done. Relaunch to get a fresh first run:"
echo "  xcrun simctl launch $UDID $BUNDLE_ID"
echo
echo "Expect: onboarding from the top, guest with 1 credit."
echo "Note: this does NOT reset App Store trial eligibility - that is tied to"
echo "the Apple ID, not the install."
