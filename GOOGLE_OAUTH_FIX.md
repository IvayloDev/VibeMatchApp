# 🔧 Google OAuth Redirect URI Fix

## Problem
Google Cloud Console doesn't accept custom URL schemes like `com.paltech.tunematch://` as redirect URIs for **Web application** OAuth clients.

## Solution
For Supabase OAuth with mobile apps, you should **ONLY** use the Supabase callback URL as the redirect URI in Google Cloud Console.

---

## ✅ Correct Configuration

### Google Cloud Console → OAuth Client

**Authorized redirect URIs:**
```
https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback
```

**That's it!** Don't add `com.paltech.tunematch://`

**Authorized JavaScript origins:**
```
https://mebjzwwtuzwcrwugxjvu.supabase.co
```

---

## How It Works

1. User taps "Continue with Google" in your app
2. App opens browser with Google OAuth
3. User signs in with Google
4. Google redirects to: `https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback`
5. Supabase processes the OAuth callback
6. Supabase redirects back to your app using the `redirectTo` parameter in your code
7. Your app handles the redirect via the custom scheme `com.paltech.tunematch://`

The custom scheme is handled by your app code, not by Google OAuth directly.

---

## Steps to Fix

1. **Go to Google Cloud Console:**
   - https://console.cloud.google.com/
   - APIs & Services → Credentials
   - Click your OAuth client ID

2. **Remove the custom scheme:**
   - Delete: `com.paltech.tunematch://`
   - Keep only: `https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback`

3. **Save**

4. **Verify Supabase:**
   - Supabase Dashboard → Authentication → Providers → Google
   - Client ID: `1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com`
   - Client Secret: (your secret)
   - Save

5. **Wait 2-3 minutes** for changes to propagate

6. **Test again**

---

## Why This Works

- Google OAuth only needs to know about the Supabase callback URL
- Your app code (in `lib/supabase.ts`) already handles the redirect back to the app using the `redirectTo: redirectUri` parameter
- The `redirectUri` with your custom scheme is passed to Supabase, not directly to Google

---

## Your Current Code (Already Correct)

Your code in `lib/supabase.ts` is already correct:

```typescript
const redirectUri = AuthSession.makeRedirectUri({
  scheme: 'com.paltech.tunematch'
});

const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: redirectUri,  // This tells Supabase where to redirect after OAuth
    // ...
  },
});
```

This is correct! The `redirectTo` tells Supabase where to send the user after OAuth completes. Google OAuth itself only needs to know about the Supabase callback URL.

---

## Summary

✅ **Google Cloud Console:** Only add `https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback`  
❌ **Don't add:** `com.paltech.tunematch://` (not allowed for web OAuth clients)  
✅ **Your code:** Already correct, no changes needed

