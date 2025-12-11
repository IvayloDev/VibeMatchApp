# 🍎 Apple Sign-In Setup - Step by Step Guide

## Prerequisites
- Apple Developer Account (paid membership required)
- Access to your app's identifier: `com.paltech.tunematch`

---

## Step 1: Enable "Sign In with Apple" Capability ⭐

### 1.1 Go to Apple Developer Portal
1. Open: https://developer.apple.com/account/
2. Sign in with your Apple Developer account
3. You should see the dashboard

### 1.2 Navigate to Identifiers
1. In the left sidebar, click **"Certificates, Identifiers & Profiles"**
2. In the left sidebar under "Identifiers", click **"Identifiers"**
3. You'll see a list of all your app identifiers

### 1.3 Find Your App Identifier
1. Look for an identifier with bundle ID: **`com.paltech.tunematch`**
   - If you don't see it, you'll need to create it first
   - Bundle ID must match exactly: `com.paltech.tunematch`

### 1.4 Enable Sign In with Apple
1. Click on the identifier `com.paltech.tunematch`
2. You'll see a list of capabilities/services
3. Find **"Sign In with Apple"** in the list
4. Check the checkbox next to it
5. Click **"Save"** (top right)

**✅ Checkpoint:** Capability is now enabled!

---

## Step 2: Get Your Apple Team ID 📋

### 2.1 Find Team ID
1. Still in Apple Developer Portal
2. Click on your name/account in the top right
3. Click **"Membership"**
4. Your **Team ID** is displayed (looks like: `ABC123DEF4`)
5. **Copy this Team ID** - you'll need it for Supabase!

**✅ Checkpoint:** You have your Team ID: `PXW34ELDXE` ✅

---

## Step 3: Create Apple Service Key 🔑

### 3.1 Navigate to Keys
1. In left sidebar: **Certificates, Identifiers & Profiles**
2. Click **"Keys"** (under "Identifiers")
3. You'll see a list of existing keys (if any)

### 3.2 Create New Key
1. Click the **"+"** button (top left, blue plus icon)
2. Enter a **Key Name**: `Sign In with Apple - TuneMatch` (or any name you prefer)
3. Check the box: **"Sign In with Apple"**
4. Click **"Continue"** (top right)
5. Review and click **"Register"** (top right)

### 3.3 Download the Key ⚠️ CRITICAL
1. **Important:** You can only download this key ONCE!
2. Click **"Download"** to download the `.p8` file
3. Save it securely (you'll need it for Supabase)
4. **Note the Key ID** displayed on the page (looks like: `ABC123DEF4`)
5. **Copy the Key ID** - you'll need it!

**✅ Checkpoint:** 
- Key ID: `_________________`
- `.p8` file downloaded: `✅ Yes / ❌ No`

### 3.4 Open the .p8 File
1. Open the downloaded `.p8` file in a text editor
2. It should look like:
   ```
   -----BEGIN PRIVATE KEY-----
   MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg...
   (many more lines)
   -----END PRIVATE KEY-----
   ```
3. **Copy the entire contents** (including BEGIN and END lines)
4. You'll paste this into Supabase

**✅ Checkpoint:** Private key contents copied: `✅ Yes`

---

## Step 4: Configure in Supabase Dashboard 🔧

### 4.1 Open Supabase Dashboard
1. Go to: https://supabase.com/dashboard
2. Sign in
3. Select your project (the one with URL: `mebjzwwtuzwcrwugxjvu.supabase.co`)

### 4.2 Navigate to Authentication Providers
1. In the left sidebar, click **"Authentication"**
2. Click **"Providers"** (under Authentication)
3. You'll see a list of authentication providers

### 4.3 Configure Apple Provider
1. Scroll down and find **"Apple"** provider
2. Click on it to expand
3. Toggle **"Enable Apple provider"** to **ON** (green)

### 4.4 Fill in Apple Credentials
Now fill in the fields with the information you collected:

1. **Services ID (optional):**
   - You can leave this empty for now
   - Only needed for more advanced setups

2. **Team ID:**
   - Paste your Team ID from Step 2
   - Format: `ABC123DEF4` (letters and numbers, no spaces)

3. **Key ID:**
   - Paste your Key ID from Step 3.3
   - Format: `ABC123DEF4` (letters and numbers, no spaces)

4. **Private Key:**
   - Paste the entire contents of your `.p8` file from Step 3.4
   - Must include:
     - `-----BEGIN PRIVATE KEY-----`
     - All the encrypted content in the middle
     - `-----END PRIVATE KEY-----`
   - Make sure there are no extra spaces or line breaks

### 4.5 Save Configuration
1. Scroll down and click **"Save"**
2. Wait for confirmation message
3. The Apple provider should now be enabled

**✅ Checkpoint:** Apple provider configured in Supabase: `✅ Yes / ❌ No`

---

## Step 5: Test Apple Sign-In 🧪

### 5.1 Build and Run Your App
1. Make sure your app is built for iOS (simulator or device)
2. The code is already set up - no changes needed!

### 5.2 Test the Sign-In Flow
1. Open your app
2. Navigate to the Sign In screen
3. You should see a **"Continue with Apple"** button (iOS only)
4. Tap the button
5. Apple Sign-In prompt should appear
6. Complete the authentication

### 5.3 Verify Success
- ✅ User should be signed in
- ✅ Should navigate to the main app
- ✅ Check Supabase Dashboard → Authentication → Users to see the new user

**✅ Checkpoint:** Apple Sign-In working: `✅ Yes / ❌ No`

---

## Troubleshooting ❓

### "Sign In with Apple" capability not showing?
- Make sure you have a paid Apple Developer account
- Try refreshing the page
- Check that you're looking at the correct identifier

### Can't find your app identifier?
- You may need to create it first:
  1. Click "+" to add new identifier
  2. Select "App IDs"
  3. Enter bundle ID: `com.paltech.tunematch`
  4. Enable "Sign In with Apple"
  5. Complete registration

### Key download failed?
- Make sure you clicked "Download" immediately after creating
- If you missed it, you'll need to create a new key
- The old key won't work if you don't have the file

### Supabase configuration errors?
- Verify Team ID format (no spaces, correct case)
- Verify Key ID format (no spaces, correct case)
- Check Private Key includes BEGIN and END lines
- Make sure there are no extra characters or spaces

### "Apple Sign-In is not available" in app?
- Make sure you're testing on iOS device or simulator (not Android or web)
- Verify capability is enabled in Apple Developer
- Rebuild the app after enabling capability
- Check that `usesAppleSignIn: true` is in your `app.json` (✅ it is!)

---

## Quick Reference Checklist ✅

- [ ] Step 1: Enabled "Sign In with Apple" capability in Apple Developer
- [ ] Step 2: Got Team ID: `_________________`
- [ ] Step 3: Created key and downloaded `.p8` file
- [ ] Step 3: Got Key ID: `_________________`
- [ ] Step 4: Configured Apple provider in Supabase
- [ ] Step 4: Saved configuration
- [ ] Step 5: Tested and verified it works

---

**Next Steps:** Once Apple Sign-In is working, we'll move on to Google Sign-In setup!

**Need Help?** Let me know which step you're on or if you encounter any issues!

