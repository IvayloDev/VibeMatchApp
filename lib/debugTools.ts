/**
 * Whether the in-app debug affordances (currently the floating credit button)
 * are compiled in.
 *
 * `__DEV__` covers local Metro runs. The env flag is what makes the tools
 * available in a RELEASE build, which is the case that actually matters:
 * TestFlight builds are Release, so `__DEV__` is false there and a
 * `__DEV__`-only tool would be invisible exactly where testing happens.
 *
 * The flag is set per EAS build profile in eas.json - on `development` and
 * `preview-testflight`, and deliberately NOT on `production`. That is the
 * safeguard: an App Store build cannot carry these tools, because the value is
 * inlined at build time from the profile that produced it.
 *
 * If you add a profile that ships to real users, do not set this flag on it.
 */
export const DEBUG_TOOLS_ENABLED =
  __DEV__ || process.env.EXPO_PUBLIC_DEBUG_TOOLS === '1';
