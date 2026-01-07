# RevenueCat Android Setup for Real Environment Testing

## 🔑 Get Your Android API Key

1. **Go to RevenueCat Dashboard:**
   - Visit: https://app.revenuecat.com
   - Login to your account
   - Select your project: **TuneMatch**

2. **Find Android API Key:**
   - Go to **Project Settings** → **API Keys**
   - Find the **Android (Google Play)** API key
   - It starts with `goog_...` (not `appl_...`)
   - Copy the key

3. **Update the Code:**
   - Open `lib/revenuecat.ts`
   - Replace `'goog_YOUR_ANDROID_KEY_HERE'` with your actual Android key
   - Save the file

## ✅ Configuration Already Done

The code has been updated to:
- ✅ Use platform-specific API keys (iOS vs Android)
- ✅ Enable RevenueCat in development mode
- ✅ Auto-detect the platform and use the correct key

## 📱 After Adding Your Android Key

1. **Restart the app:**
   - The app should reload automatically
   - Or restart Metro: `npx expo start --android --clear`

2. **Test Purchases:**
   - Make sure your Android products are configured in RevenueCat
   - Products should be linked to Google Play Console
   - Use a test Google account for sandbox testing

## 🎯 Products to Configure in RevenueCat

Make sure these products exist in RevenueCat for Android:
- `tunematch_credits_5`
- `tunematch_credits_18`
- `tunematch_credits_60`
- `tunematch_credits_150`

They should be linked to Google Play Console products with the same IDs.

## ⚠️ Important Notes

- **Development Build Required:** RevenueCat requires a development build (not Expo Go)
- **Google Play Console:** Products must exist in Google Play Console
- **Sandbox Testing:** Use test accounts for sandbox purchase testing
- **Real Purchases:** Test purchases will use real payment methods (can be refunded)

