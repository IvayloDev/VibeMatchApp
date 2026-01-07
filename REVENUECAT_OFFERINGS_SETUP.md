# RevenueCat Offerings Setup

## 🚨 Current Issues

1. **BlueStacks Billing Limitation:** BlueStacks doesn't support Google Play Billing. You'll need a real Android device or Android Studio emulator to test purchases.

2. **Products Not in Offerings:** Products need to be added to a RevenueCat Offering.

## ✅ Fix: Configure Offerings in RevenueCat

### Step 1: Go to RevenueCat Dashboard
1. Navigate to: https://app.revenuecat.com
2. Select your project
3. Click **"Offerings"** in the left sidebar

### Step 2: Create/Edit Default Offering
1. Click on **"default"** offering (or create one if it doesn't exist)
2. Click **"Add Packages"** or **"Edit"**

### Step 3: Add Products to Offering
Add these 4 products (must match exactly):
- `tunematch_credits_5` - 5 Credits
- `tunematch_credits_18` - 18 Credits  
- `tunematch_credits_60` - 60 Credits
- `tunematch_credits_150` - 150 Credits

### Step 4: Link to Google Play Products
For each product:
1. Make sure it's linked to a Google Play Console product with the same ID
2. The product IDs must match exactly: `tunematch_credits_5`, etc.

### Step 5: Set as Current Offering
1. Make sure the "default" offering is marked as **"Current"**
2. Save changes

## 📱 Testing on Real Device or Android Emulator

### Option 1: Real Android Device (Recommended)
1. Enable USB Debugging
2. Connect via USB
3. Run: `npx expo run:android`
4. Use test Google account for sandbox testing

### Option 2: Android Studio Emulator
1. Open Android Studio
2. Create AVD (Android Virtual Device) with Google Play services
3. Start emulator
4. Run: `npx expo run:android`
5. Sign in with test Google account

## ⚠️ BlueStacks Limitation

**BlueStacks does NOT support Google Play Billing**, so you cannot test real purchases on it. You'll see:
- ✅ RevenueCat initializes successfully
- ❌ `BILLING_UNAVAILABLE` error when trying to purchase
- ❌ Falls back to mock packages

**Solution:** Use a real Android device or Android Studio emulator with Google Play services.

## 🔍 Verify Configuration

After configuring offerings, check:
1. ✅ Products added to "default" offering
2. ✅ Offering marked as "Current"
3. ✅ Products linked to Google Play Console
4. ✅ Product IDs match exactly: `tunematch_credits_*`

Then test on a real device or Android Studio emulator (not BlueStacks).

