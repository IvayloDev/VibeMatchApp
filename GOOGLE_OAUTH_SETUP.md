# 🔵 Google OAuth Setup Guide

## Current Status
- ✅ Code is already implemented in `lib/supabase.ts`
- ✅ Client ID exists: `1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com`
- ⚠️ Need to configure Google Cloud Console
- ⚠️ Need to configure Supabase Dashboard

---

## Step 1: Configure Google Cloud Console

### 1.1 Go to Google Cloud Console
1. Visit: https://console.cloud.google.com/
2. Sign in with your Google account
3. Select your project (or create one if needed)

### 1.2 Navigate to OAuth Credentials
1. In the left sidebar, click **"APIs & Services"**
2. Click **"Credentials"**
3. Find your OAuth 2.0 Client ID: `1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com`
4. **Click on it** to edit

### 1.3 Add Authorized Redirect URIs

**⚠️ CRITICAL:** You must add these exact URIs:

#### Authorized redirect URIs:
Add these one by one (click "Add URI" for each):

1. **Supabase Callback:**
   ```
   https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback
   ```

2. **Your App Deep Link:**
   ```
   com.paltech.tunematch://
   ```

3. **Alternative format (if needed):**
   ```
   com.paltech.tunematch:/
   ```

#### Authorized JavaScript origins:
Add this:

```
https://mebjzwwtuzwcrwugxjvu.supabase.co
```

### 1.4 Save Changes
1. Scroll down and click **"Save"**
2. Wait a few minutes for changes to propagate

**✅ Checkpoint:** Redirect URIs configured in Google Cloud Console

---

## Step 2: Get Your Client Secret

### 2.1 View Client Secret
1. Still in Google Cloud Console → Credentials
2. Click your OAuth client ID
3. You'll see:
   - **Client ID**: `1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com`
   - **Client secret**: `GOCSPX-...` (click "Show" to reveal it)

### 2.2 Copy Client Secret
1. Click **"Show"** next to Client secret
2. **Copy the entire secret** (starts with `GOCSPX-`)
3. Keep it secure - you'll need it for Supabase

**✅ Checkpoint:** Client Secret copied: `_________________`

---

## Step 3: Configure Supabase Dashboard

### 3.1 Go to Supabase Dashboard
1. Visit: https://supabase.com/dashboard
2. Sign in
3. Select your project: `mebjzwwtuzwcrwugxjvu`

### 3.2 Navigate to Google Provider
1. In the left sidebar, click **"Authentication"**
2. Click **"Providers"** (under Authentication)
3. Scroll down and find **"Google"** provider
4. **Click on it** to expand

### 3.3 Enable and Configure Google Provider

1. **Toggle "Enable Google provider"** to **ON** (green)

2. **Fill in the fields:**

   - **Client ID (for OAuth):**
     ```
     1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com
     ```

   - **Client Secret (for OAuth):**
     ```
     GOCSPX-... (paste your client secret from Step 2)
     ```

3. **Authorized Redirect URIs:**
   - This should auto-populate with:
     ```
     https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback
     ```
   - Verify it's there (it should be by default)

### 3.4 Save Configuration
1. Scroll down and click **"Save"**
2. Wait a moment for the configuration to apply

**✅ Checkpoint:** Google provider configured in Supabase

---

## Step 4: Verify OAuth Consent Screen

### 4.1 Check OAuth Consent Screen
1. In Google Cloud Console → **"APIs & Services"** → **"OAuth consent screen"**
2. Make sure it's configured:
   - **User Type**: External (for public apps) or Internal (for Google Workspace)
   - **App name**: Your app name
   - **User support email**: Your email
   - **Developer contact information**: Your email

### 4.2 Publish Status
- If your app is in **"Testing"** mode:
  - Only test users can sign in
  - Add test users in the "Test users" section
- If your app is in **"Production"** mode:
  - Anyone can sign in
  - May require verification for sensitive scopes

**For testing:** Add yourself as a test user:
1. Go to OAuth consent screen
2. Scroll to "Test users"
3. Click "Add Users"
4. Add your Google email address

**✅ Checkpoint:** OAuth consent screen configured

---

## Step 5: Test Google Sign-In

### 5.1 Test in Your App
1. Open your app (on device or simulator)
2. Navigate to Sign In or Sign Up screen
3. Tap **"Continue with Google"** button
4. You should see:
   - Browser opens with Google sign-in
   - Select your Google account
   - Redirects back to your app
   - User is signed in

### 5.2 Verify in Supabase
1. Go to Supabase Dashboard → Authentication → Users
2. You should see a new user with:
   - Provider: `google`
   - Email: Your Google email
   - Created at: Just now

**✅ Checkpoint:** Google Sign-In working!

---

## Troubleshooting

### "Redirect URI mismatch" Error

**Problem:** Google says the redirect URI doesn't match

**Solution:**
1. Double-check redirect URIs in Google Cloud Console
2. Make sure they match exactly (including `://` vs `:/`)
3. Wait 5-10 minutes after saving for changes to propagate
4. Try these variations:
   - `com.paltech.tunematch://`
   - `com.paltech.tunematch:/`
   - `com.paltech.tunematch://oauth/callback`

### "Access blocked: This app's request is invalid"

**Problem:** OAuth consent screen not configured or app in testing mode

**Solution:**
1. Go to OAuth consent screen in Google Cloud Console
2. Make sure it's configured
3. Add yourself as a test user if in testing mode
4. Or publish the app to production (if ready)

### "Invalid client" Error

**Problem:** Client ID or Secret is wrong in Supabase

**Solution:**
1. Double-check Client ID in Supabase matches Google Cloud Console
2. Verify Client Secret is correct (no extra spaces)
3. Make sure you copied the entire secret

### Sign-In Opens but Doesn't Redirect Back

**Problem:** Deep link not configured or redirect URI mismatch

**Solution:**
1. Verify `com.paltech.tunematch://` is in Google Cloud Console redirect URIs
2. Check that your `app.json` has the correct scheme:
   ```json
   "scheme": "com.paltech.tunematch"
   ```
3. Make sure the app is built with the correct bundle identifier

### "This app isn't verified" Warning

**Problem:** App is in testing mode or not verified

**Solution:**
- For testing: Add yourself as a test user
- For production: Complete app verification process (if required)

---

## Quick Checklist ✅

### Google Cloud Console:
- [ ] OAuth 2.0 Client ID exists
- [ ] Redirect URI added: `https://mebjzwwtuzwcrwugxjvu.supabase.co/auth/v1/callback`
- [ ] Redirect URI added: `com.paltech.tunematch://`
- [ ] JavaScript origin added: `https://mebjzwwtuzwcrwugxjvu.supabase.co`
- [ ] Client Secret copied
- [ ] OAuth consent screen configured
- [ ] Test user added (if in testing mode)

### Supabase Dashboard:
- [ ] Google provider enabled
- [ ] Client ID configured
- [ ] Client Secret configured
- [ ] Redirect URI verified

### Testing:
- [ ] Google Sign-In button works
- [ ] Browser opens with Google sign-in
- [ ] Can select Google account
- [ ] Redirects back to app
- [ ] User is signed in
- [ ] User appears in Supabase Users table

---

## Next Steps

Once Google Sign-In is working:
1. ✅ Test on both iOS and Android
2. ✅ Test with different Google accounts
3. ✅ Verify user data is saved correctly
4. ✅ Test sign-out functionality
5. ✅ Prepare for production (verify app if needed)

---

## Quick Reference

**Your Configuration:**
- **Client ID**: `1010555883524-les6p9sormf3qb5fe6k6ru6likvpe9tu.apps.googleusercontent.com`
- **Supabase URL**: `https://mebjzwwtuzwcrwugxjvu.supabase.co`
- **App Scheme**: `com.paltech.tunematch`
- **Bundle ID**: `com.paltech.tunematch`

**Useful Links:**
- Google Cloud Console: https://console.cloud.google.com/
- Supabase Dashboard: https://supabase.com/dashboard
- OAuth Consent Screen: https://console.cloud.google.com/apis/credentials/consent

---

**Need Help?** Let me know which step you're on or if you encounter any errors!

