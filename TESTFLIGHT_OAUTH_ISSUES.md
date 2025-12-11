# 🧪 TestFlight OAuth Issues

## Could TestFlight Be Causing the Issue?

**Short answer:** Possibly, but the "Invalid_client" error suggests it's more likely a configuration issue.

---

## TestFlight-Specific Considerations

### 1. URL Scheme Registration
TestFlight builds need the URL scheme properly registered in `Info.plist`. Let's verify:

**Check:** `ios/TuneMatch/Info.plist` should have:
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.paltech.tunematch</string>
    </array>
  </dict>
</array>
```

### 2. OAuth Flow Differences
- **Development builds:** May use different redirect handling
- **TestFlight builds:** Use production-like redirect handling
- **The error happens BEFORE redirect:** "Invalid_client" means Google can't find the OAuth client, which happens before any redirect

---

## The Real Issue

The "Invalid_client" / "OAuth client was not found" error happens **at the Google OAuth level**, not during the redirect. This means:

1. ✅ Your URL scheme is probably fine
2. ❌ The Client ID in Supabase doesn't match Google Cloud Console
3. ❌ Or the OAuth client doesn't exist/is disabled

---

## How to Verify

### Step 1: Check the Error Timing
- **If error appears immediately:** Configuration issue (Client ID mismatch)
- **If error appears after Google sign-in:** Redirect/URL scheme issue

### Step 2: Test in Development Build
Try the same OAuth flow in a development build:
```bash
npx expo run:ios --device
```

If it works in dev but not TestFlight, it's a TestFlight-specific issue.
If it fails in both, it's a configuration issue.

### Step 3: Check Console Logs
In your TestFlight app, check the console logs for:
```
Redirect URI: com.paltech.tunematch://...
```

This will show what redirect URI is being generated.

---

## TestFlight-Specific Fixes

### Fix 1: Verify URL Scheme in Info.plist
Make sure `com.paltech.tunematch` is registered in `Info.plist`.

### Fix 2: Use Explicit Redirect URI
Instead of relying on `AuthSession.makeRedirectUri()`, you could try an explicit redirect:

```typescript
const redirectUri = 'com.paltech.tunematch://oauth/callback';
```

But this shouldn't be necessary - `makeRedirectUri()` should work.

### Fix 3: Check Supabase Configuration
The most likely issue is still the Client ID mismatch in Supabase Dashboard.

---

## Most Likely Cause

Given the "Invalid_client" error, the issue is **NOT** TestFlight-specific. It's a configuration issue:

1. **Client ID mismatch** between Supabase and Google Cloud Console
2. **OAuth client deleted/disabled** in Google Cloud Console
3. **Wrong Client Secret** in Supabase

---

## Quick Test

1. **Check Supabase Dashboard:**
   - Authentication → Providers → Google
   - Verify Client ID: `1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com`
   - Verify Client Secret is set

2. **Check Google Cloud Console:**
   - Verify the OAuth client exists
   - Verify it's enabled
   - Verify the Client ID matches exactly

3. **Test in Development:**
   - If it works in dev but not TestFlight → TestFlight issue
   - If it fails in both → Configuration issue

---

## Conclusion

While TestFlight *could* cause redirect issues, the "Invalid_client" error suggests a **configuration problem**, not a TestFlight-specific issue. Focus on verifying the Client ID and Secret match between Supabase and Google Cloud Console.

