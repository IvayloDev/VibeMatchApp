# Running App on Android Phone - Setup Guide

## 📱 Two Methods

Since your app uses native modules (RevenueCat, etc.), you have two options:

### Option 1: Development Build (Recommended) ⭐
Build and install a development client on your phone. Best for testing native features.

### Option 2: Expo Go (Limited)
Only works if all features are compatible. Your app has native modules, so this may not work fully.

---

## 🚀 Option 1: Development Build (Recommended)

### Prerequisites

1. **Enable USB Debugging on your Android phone:**
   - Go to Settings → About Phone
   - Tap "Build Number" 7 times to enable Developer Options
   - Go back to Settings → Developer Options
   - Enable "USB Debugging"
   - Connect phone via USB cable

2. **Install Android SDK & ADB** (if not already installed):
   ```bash
   # On macOS, you can install via Homebrew:
   brew install --cask android-platform-tools
   
   # Or download Android Studio and use its SDK
   ```

3. **Verify phone is connected:**
   ```bash
   adb devices
   ```
   You should see your device listed. If not, accept the USB debugging prompt on your phone.

### Steps

#### Step 1: Install dependencies (if needed)
```bash
npm install
```

#### Step 2: Build and run development build directly on phone
```bash
npx expo run:android
```

This will:
- Build a development client APK
- Install it on your connected phone
- Start the development server
- Launch the app automatically

**Note:** First build can take 5-10 minutes. Subsequent builds are faster.

#### Alternative: Build APK manually

If you want to build the APK separately:

```bash
# Build APK
eas build --profile development --platform android

# Or build locally (faster, but requires Android Studio setup)
npx expo run:android --variant debug
```

Then install the APK on your phone.

---

## 📲 Option 2: Using Expo Go (Quick Test - Limited)

**⚠️ Warning:** Your app uses RevenueCat and other native modules. Expo Go may not support all features.

### Steps:

1. **Install Expo Go app** on your Android phone from Google Play Store

2. **Start development server:**
   ```bash
   npm start
   # or
   npx expo start
   ```

3. **Connect phone:**
   - Make sure phone and computer are on the same WiFi network
   - Scan QR code shown in terminal with Expo Go app
   - Or press `a` in terminal to open on Android device

---

## 🔧 Troubleshooting

### Phone not detected by ADB

**Check connection:**
```bash
adb devices
```

**If empty list:**
1. Make sure USB debugging is enabled (see Prerequisites)
2. Accept USB debugging prompt on phone
3. Try different USB cable/port
4. Install phone drivers (if needed)

**If "unauthorized":**
- Check your phone screen for USB debugging authorization prompt
- Click "Always allow from this computer"

### Build fails

**Clear cache:**
```bash
npx expo start --clear
```

**Clean Android build:**
```bash
cd android
./gradlew clean
cd ..
npx expo run:android
```

### App crashes on launch

1. Check Metro bundler is running
2. Check phone and computer are on same network
3. Check logs: `adb logcat` or check terminal output

### Network issues (app can't connect to dev server)

**Use USB tunneling instead of WiFi:**
```bash
npx expo start --tunnel
```

Or manually forward port:
```bash
adb reverse tcp:8081 tcp:8081
```

---

## 🎯 Quick Start (TL;DR)

**Fastest way to get running:**

1. **Enable USB Debugging** on Android phone
2. **Connect phone via USB**
3. **Run:**
   ```bash
   npx expo run:android
   ```
4. **Wait for build and installation** (first time: 5-10 min)

---

## 📝 After First Build

Once the development client is installed on your phone:

1. **Start dev server:**
   ```bash
   npm start
   ```

2. **Launch app on phone** (it should auto-connect)
   - Or manually open the app from your phone
   - It will connect to your dev server automatically

3. **Make changes** - App will reload automatically with Hot Reload!

---

## 💡 Development Tips

### View logs on phone:
```bash
adb logcat | grep ReactNative
```

### Reload app manually:
- Shake phone → "Reload"
- Or press `r` in terminal

### Open Dev Menu:
- Shake phone → Dev Settings
- Or `adb shell input keyevent 82` (menu button)

---

## 🔄 Updating the App

If you add new native dependencies:

1. Stop the dev server
2. Rebuild: `npx expo run:android`
3. The new build will include the new native code

For JavaScript-only changes, just save the file - Hot Reload will update automatically!

---

**Need help?** Check Expo docs: https://docs.expo.dev/development/build/introduction/

