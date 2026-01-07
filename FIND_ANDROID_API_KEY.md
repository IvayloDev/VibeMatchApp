# How to Find Your Android RevenueCat API Key

## 📍 Location in RevenueCat Dashboard

The Android API key is **NOT** on the app configuration page. Follow these steps:

### Step 1: Go to Project Settings
1. In RevenueCat Dashboard, look for **"Project Settings"** in the left sidebar
2. Click on **"Project Settings"**

### Step 2: Find API Keys Section
1. In Project Settings, look for **"API Keys"** section
2. You'll see two keys listed:
   - **iOS** key (starts with `appl_...`)
   - **Android (Google Play)** key (starts with `goog_...`)

### Step 3: Copy Android Key
1. Find the key labeled **"Android (Google Play)"** or **"Google Play"**
2. Click the copy icon next to it
3. It should look like: `goog_xxxxxxxxxxxxxxxxxxxx`

### Step 4: Update Code
1. Open `lib/revenuecat.ts`
2. Find line 229: 
   ```typescript
   const REVENUECAT_API_KEY_ANDROID = 'goog_YOUR_ANDROID_KEY_HERE';
   ```
3. Replace `'goog_YOUR_ANDROID_KEY_HERE'` with your actual key:
   ```typescript
   const REVENUECAT_API_KEY_ANDROID = 'goog_xxxxxxxxxxxxxxxxxxxx';
   ```
4. Save the file

## ✅ Confirmed from Your Screenshot

- ✅ Package name matches: `com.paltech.tunematch`
- ✅ RevenueCat ID: `app30eea050c3`
- ✅ Service account credentials: Valid
- ⚠️ Pub/Sub permission warning: Non-critical (only affects real-time notifications)

## 🔑 Quick Checklist

- [ ] Navigate to Project Settings → API Keys
- [ ] Find Android (Google Play) key (starts with `goog_`)
- [ ] Copy the key
- [ ] Paste into `lib/revenuecat.ts` line 229
- [ ] Save the file
- [ ] App will reload automatically

The Pub/Sub permission error you see is not critical for testing purchases - it only affects real-time purchase notifications. Your purchases will still work and be validated.

