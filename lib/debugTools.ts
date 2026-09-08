/**
 * Whether the in-app debug affordances (currently the floating RESET pill) are
 * compiled in.
 *
 * `__DEV__` covers local Metro runs. The env flag is what makes the tools
 * available in a RELEASE build, which is the case that actually matters:
 * TestFlight builds are Release, so `__DEV__` is false there and a
 * `__DEV__`-only tool would be invisible exactly where testing happens.
 *
 * The flag is set per EAS build profile in eas.json - on `development` and
 * `device-test` only, and deliberately NOT on `production` or
 * `preview-testflight`. That is the safeguard: neither a store build nor a
 * TestFlight build can carry these tools, because the value is inlined at
 * build time from the profile that produced it.
 *
 * It used to be set on `preview-testflight` too, so testers could reset state.
 * That is genuinely useful - clearing tunematch_device_id is the only way to
 * re-test the starter grant, which is rationed per device - but a RESET button
 * that wipes a real person's credits and history does not belong in a build
 * handed to other people. Use `device-test` on your own hardware for that.
 *
 * If you add a profile that ships to real users, do not set this flag on it.
 */
export const DEBUG_TOOLS_ENABLED =
  __DEV__ || process.env.EXPO_PUBLIC_DEBUG_TOOLS === '1';
