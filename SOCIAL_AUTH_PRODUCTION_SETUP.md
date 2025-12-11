# 🔐 Social Auth Production Setup Guide

## Current Status
- ✅ Code is implemented and ready
- ✅ Google Client ID exists: `1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com`
- ⚠️ Need to configure Supabase Dashboard
- ⚠️ Need to verify redirect URIs

---

## 🍎 APPLE SIGN-IN Setup

### Step 1: Apple Developer Account

1. **Go to:** [Apple Developer](https://developer.apple.com/account/)
2. **Navigate to:** Certificates, Identifiers & Profiles
3. **Click:** Identifiers → Your App Identifier (com.paltech.tunematch)
4. **Enable:** "Sign In with Apple" capability
5. **Save** the changes

### Step 2: Get Apple Credentials

You'll need:
- **Team ID**: Found in Apple Developer Account → Membership
- **Key ID**: 
  1. Go to Keys section
  2. Create a new key (or use existing)
  3. Enable "Sign In with Apple"
  4. Download the `.p8` file (you can only download once!)
  5. Note the Key ID shown

### Step 3: Configure in Supabase Dashboard

1. **Go to:** [Supabase Dashboard](https://supabase.com/dashboard) → Your Project
2. **Navigate to:** Authentication → Providers
3. **Click:** Apple provider
4. **Enable** Apple provider
5. **Fill in:**
   - **Team ID**: Your Apple Team ID (found in Apple Developer account)
   - **Key ID**: The Key ID from Step 2
   - **Private Key**: Contents of the `.p8` file you downloaded
   - **Service ID**: Optional (can be left empty for most setups)
6. **Save**

### Step 4: App Store Connect (Optional but Recommended)

1. **Go to:** [App Store Connect](https://appstoreconnect.apple.com/)
2. **Navigate to:** Your App → App Information
3. **Enable:** Sign In with Apple
4. **Configure:** Any required settings

**Note:** Your app already has `usesAppleSignIn: true` in `app.json`, so you're good there!

---

## 🔵 GOOGLE SIGN-IN Setup

### Step 1: Verify Google Cloud Console Setup

Your current Google Client ID: `1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com`

1. **Go to:** [Google Cloud Console](https://console.cloud.google.com/)
2. **Navigate to:** APIs & Services → Credentials
3. **Find:** Your OAuth 2.0 Client ID (the one ending in `...tu.apps.googleusercontent.com`)
4. **Click** to edit it

### Step 2: Configure Authorized Redirect URIs

**⚠️ CRITICAL:** Add these redirect URIs to your Google OAuth client:

1. **Supabase Redirect URI:**
   ```
   https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback
   ```

2. **Your App Scheme (for mobile):**
   ```
   com.paltech.tunematch://
   ```
   (Note: Your app.json uses `com.paltech.tunematch` but code uses `com.paltech.vibematch` - we need to fix this!)

3. **Authorized JavaScript origins:**
   ```
   https://mebjzwwtuzwcrwugxjvu.supabase.co
   ```

**To add:**
- Click "Add URI" for each redirect URI above
- Click "Add URI" for authorized JavaScript origins
- **Save**

### Step 3: Get Google Client Secret (if needed)

1. In Google Cloud Console → Credentials
2. Click your OAuth client
3. Note the **Client Secret** (or create a new one if needed)
4. Keep this secure (you'll need it for Supabase)

### Step 4: Configure in Supabase Dashboard

1. **Go to:** [Supabase Dashboard](https://supabase.com/dashboard) → Your Project
2. **Navigate to:** Authentication → Providers
3. **Click:** Google provider
4. **Enable** Google provider
5. **Fill in:**
   - **Client ID (for OAuth)**: `1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com`
   - **Client Secret (for OAuth)**: Your Google Client Secret from Step 3
6. **Authorized Redirect URIs** should auto-populate, but verify it includes:
   - `https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback`
7. **Save**

### Step 5: Fix Redirect URI Mismatch ⚠️

**Issue Found:** 
- Your `app.json` uses: `com.paltech.tunematch`
- Your code (`lib/supabase.ts`) uses: `com.paltech.vibematch`

**Fix needed:** Update `lib/supabase.ts` to match your app.json:

```typescript
const redirectUri = AuthSession.makeRedirectUri({
  scheme: 'com.paltech.tunematch'  // Changed from vibematch
});
```

Or vice versa - make sure they match!

---

## ✅ Verification Checklist

### Apple Sign-In:
- [ ] "Sign In with Apple" enabled in Apple Developer Account
- [ ] Apple provider enabled in Supabase Dashboard
- [ ] Team ID configured in Supabase
- [ ] Key ID and Private Key configured in Supabase
- [ ] Tested on iOS device/simulator

### Google Sign-In:
- [ ] OAuth 2.0 client exists in Google Cloud Console
- [ ] Redirect URI added: `https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback`
- [ ] App scheme redirect URI added: `com.paltech.tunematch://`
- [ ] Authorized JavaScript origin added
- [ ] Google provider enabled in Supabase Dashboard
- [ ] Client ID and Secret configured in Supabase
- [ ] Redirect URI scheme matches between code and app.json
- [ ] Tested on iOS device
- [ ] Tested on Android device

---

## 🧪 Testing

### Test Apple Sign-In:
1. Build app for iOS (or use simulator)
2. Navigate to Sign In screen
3. Click "Continue with Apple"
4. Should show Apple authentication prompt
5. Complete authentication
6. Should sign in successfully

### Test Google Sign-In:
1. Build app for iOS or Android
2. Navigate to Sign In screen
3. Click "Continue with Google"
4. Should open browser with Google sign-in
5. Select Google account
6. Should redirect back to app
7. Should sign in successfully

---

## 🚨 Common Issues

### "Redirect URI mismatch" error:
- ✅ Verify redirect URIs match exactly in Google Cloud Console
- ✅ Check that scheme in code matches app.json
- ✅ Ensure Supabase callback URL is added

### "Apple Sign-In not available":
- ✅ Verify "Sign In with Apple" is enabled in Apple Developer
- ✅ Check that you're testing on iOS device/simulator (not web)
- ✅ Verify capability is enabled in Xcode project

### "Invalid client" error (Google):
- ✅ Verify Client ID matches in code and Supabase
- ✅ Check Client Secret is correct
- ✅ Ensure OAuth consent screen is configured in Google Cloud

### Authentication succeeds but user can't access app:
- ✅ Check Supabase RLS policies
- ✅ Verify user_profiles table auto-creates on signup
- ✅ Check Supabase logs for errors

---

## 📝 Notes

1. **Apple Sign-In** only works on iOS devices/simulators (not Android or web)
2. **Google Sign-In** works on both iOS and Android
3. Redirect URIs are case-sensitive - match them exactly!
4. After changing OAuth settings, wait a few minutes for propagation
5. Test with production builds, not just development mode
6. Keep your `.p8` file secure - you can only download it once!

---

## 🔗 Quick Links

- **Apple Developer:** https://developer.apple.com/account/
- **Google Cloud Console:** https://console.cloud.google.com/
- **Supabase Dashboard:** https://supabase.com/dashboard
- **App Store Connect:** https://appstoreconnect.apple.com/

---

**Last Updated:** Based on current codebase
**Priority:** Fix redirect URI mismatch before production!

