# 🔧 Google OAuth "Invalid_client" Error - Troubleshooting

## Error: "OAuth client was not found" / "Invalid_client"

This error means the Client ID in Supabase doesn't match what's in Google Cloud Console.

---

## Step 1: Verify Google Cloud Console OAuth Client

1. **Go to:** https://console.cloud.google.com/
2. **Navigate to:** APIs & Services → Credentials
3. **Find your OAuth 2.0 Client ID**
4. **Check:**
   - ✅ Does it exist?
   - ✅ Is it enabled?
   - ✅ What's the exact Client ID? (copy it)

**Expected Client ID format:**
```
1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com
```
1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com
---
1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com
## Step 2: Verify Supabase Dashboard Configuration

1. **Go to:** https://supabase.com/dashboard
2. **Navigate to:** Your Project → Authentication → Providers → Google
3. **Check the Client ID:**
   - Does it match EXACTLY with Google Cloud Console?
   - No extra spaces?
   - No typos?

**⚠️ CRITICAL:** The Client ID in Supabase MUST match Google Cloud Console EXACTLY!

---

## Step 3: Common Issues & Fixes

### Issue 1: Client ID Mismatch
**Problem:** Client ID in Supabase doesn't match Google Cloud Console

**Fix:**
1. Copy the Client ID from Google Cloud Console
2. Paste it into Supabase Dashboard → Google Provider → Client ID
3. Save
4. Wait 2-3 minutes for changes to propagate

### Issue 2: OAuth Client Deleted/Disabled
**Problem:** The OAuth client was deleted or disabled in Google Cloud Console

**Fix:**
1. Go to Google Cloud Console → Credentials
2. Check if your OAuth client exists
3. If deleted, create a new one:
   - Click "+ Create Credentials" → "OAuth client ID"
   - Application type: "Web application"
   - Name: "VibeMatch Web Client"
   - Authorized redirect URIs:
     - `https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback`
     - `com.paltech.tunematch://`
   - Authorized JavaScript origins:
     - `https://mebjzwwtuzwcrwugxjvu.supabase.co`
   - Create
4. Copy the new Client ID and Client Secret
5. Update Supabase Dashboard with the new credentials

### Issue 3: Wrong OAuth Client Type
**Problem:** Using iOS/Android client instead of Web client

**Fix:**
- For Supabase OAuth, you MUST use a **Web application** OAuth client
- Not iOS client
- Not Android client

### Issue 4: Redirect URI Mismatch
**Problem:** Redirect URIs don't match

**Fix:**
1. In Google Cloud Console → Your OAuth Client
2. Verify these redirect URIs are added:
   - `https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback`
   - `com.paltech.tunematch://`
3. Verify JavaScript origin:
   - `https://mebjzwwtuzwcrwugxjvu.supabase.co`
4. Save and wait 5-10 minutes

---

## Step 4: Quick Fix Checklist

- [ ] Go to Google Cloud Console → Credentials
- [ ] Find your OAuth 2.0 Client ID (Web application type)
- [ ] Copy the EXACT Client ID
- [ ] Go to Supabase Dashboard → Authentication → Providers → Google
- [ ] Paste the Client ID (verify it matches exactly)
- [ ] Copy the Client Secret from Google Cloud Console
- [ ] Paste it into Supabase Dashboard
- [ ] Save in Supabase
- [ ] Wait 2-3 minutes
- [ ] Test again

---

## Step 5: Verify OAuth Consent Screen

1. **Go to:** Google Cloud Console → APIs & Services → OAuth consent screen
2. **Check:**
   - Is it configured?
   - Is it published or in testing mode?
   - If testing, are you added as a test user?

---

## Step 6: Test Again

After fixing the configuration:
1. Wait 2-3 minutes for changes to propagate
2. Try Google Sign-In again
3. If it still fails, check the exact error message

---

## Still Not Working?

If you're still getting the error:

1. **Double-check Client ID:**
   - Copy from Google Cloud Console
   - Paste into Supabase
   - Compare character by character

2. **Check OAuth Client Status:**
   - Is it enabled in Google Cloud Console?
   - Is it the correct type (Web application)?

3. **Verify Redirect URIs:**
   - Must match exactly (case-sensitive)
   - No trailing slashes unless specified

4. **Check Supabase Logs:**
   - Go to Supabase Dashboard → Logs
   - Look for authentication errors
   - Check the exact error message

---

## Need to Create a New OAuth Client?

If you need to create a new OAuth client:

1. **Google Cloud Console** → Credentials → "+ Create Credentials" → "OAuth client ID"
2. **Application type:** Web application
3. **Name:** VibeMatch Web Client
4. **Authorized redirect URIs:**
   ```
   https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback
   com.paltech.tunematch://
   ```
5. **Authorized JavaScript origins:**
   ```
   https://mebjzwwtuzwcrwugxjvu.supabase.co
   ```
6. **Create** and copy Client ID + Secret
7. **Update Supabase** with new credentials

---

**Quick Reference:**
- Supabase URL: `https://mebjzwwtuzwcrwugxjvu.supabase.co`
- App Scheme: `com.paltech.tunematch`
- OAuth Client Type: **Web application** (required for Supabase)

