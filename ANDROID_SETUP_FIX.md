# Android Setup Fix - Missing Dependencies

## Issues Found:
1. ❌ Java Runtime not installed
2. ❌ Android SDK not found (ANDROID_HOME not set)

## Step 1: Install Java JDK

Android builds require Java JDK 17 (LTS). Install it:

```bash
# Install Java JDK 17 using Homebrew
brew install openjdk@17
```

After installation, link it:

```bash
sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk
```

Add to your shell profile (add these lines to `~/.zshrc`):

```bash
echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
echo 'export JAVA_HOME="/opt/homebrew/opt/openjdk@17"' >> ~/.zshrc
```

Reload your shell:
```bash
source ~/.zshrc
```

Verify Java is installed:
```bash
java -version
# Should show: openjdk version "17.x.x"
```

---

## Step 2: Install Android SDK

You have two options:

### Option A: Install Android Studio (Recommended - Easier)

1. **Download Android Studio:**
   - Go to https://developer.android.com/studio
   - Download for macOS (Apple Silicon or Intel)
   - Install it

2. **Open Android Studio and install SDK:**
   - Open Android Studio
   - Go to **Preferences** → **Appearance & Behavior** → **System Settings** → **Android SDK**
   - Install Android SDK (latest version)
   - Note the SDK location (usually: `/Users/yourname/Library/Android/sdk`)

3. **Set up environment variables:**

Add to `~/.zshrc`:
```bash
# Android SDK
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
```

Reload shell:
```bash
source ~/.zshrc
```

### Option B: Install SDK Command Line Tools Only (Lighter)

```bash
# Install Android SDK via Homebrew
brew install --cask android-commandlinetools

# Create SDK directory
mkdir -p ~/Library/Android/sdk

# Accept licenses and install components
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-33" "build-tools;33.0.0"
```

Then set environment variables (same as Option A).

---

## Step 3: Verify Setup

Run these commands to verify everything is set up:

```bash
# Check Java
java -version
# Should show Java 17

# Check Android SDK
echo $ANDROID_HOME
# Should show: /Users/ivopalchev/Library/Android/sdk

# Check ADB (Android Debug Bridge)
adb version
# Should show adb version

# Check if phone is connected
adb devices
```

---

## Step 4: Try Building Again

Once everything is installed:

```bash
npx expo run:android
```

---

## Quick Fix (All-in-One Commands)

Run these commands one by one:

```bash
# 1. Install Java
brew install openjdk@17
sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk

# 2. Add Java to PATH (adds to .zshrc)
echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
echo 'export JAVA_HOME="/opt/homebrew/opt/openjdk@17"' >> ~/.zshrc

# 3. Install Android Studio (manual step - download from website)
# OR install command line tools:
brew install --cask android-commandlinetools

# 4. Create SDK directory (if using command line tools)
mkdir -p ~/Library/Android/sdk

# 5. Add Android SDK to PATH
echo 'export ANDROID_HOME=$HOME/Library/Android/sdk' >> ~/.zshrc
echo 'export PATH=$PATH:$ANDROID_HOME/platform-tools' >> ~/.zshrc

# 6. Reload shell
source ~/.zshrc

# 7. Verify
java -version
echo $ANDROID_HOME
```

---

## Alternative: Use EAS Build (Cloud Build - No Local Setup Needed)

If you don't want to set up the Android SDK locally, you can use Expo's cloud build service:

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Build development client in the cloud
eas build --profile development --platform android

# This will build the APK in the cloud
# Download and install on your phone
```

This is slower (5-10 minutes per build) but requires no local setup.

---

## Troubleshooting

### Java version wrong
```bash
# Check which Java is being used
which java
# Should point to Java 17

# If wrong, make sure JAVA_HOME is set correctly
echo $JAVA_HOME
```

### ANDROID_HOME not found
```bash
# Check if it's set
echo $ANDROID_HOME

# If empty, find your SDK location
# Usually in: ~/Library/Android/sdk
# Then add to .zshrc as shown above
```

### ADB not found
```bash
# Make sure platform-tools are installed
# In Android Studio: SDK Manager → SDK Tools → Android SDK Platform-Tools

# Or install via command line:
sdkmanager "platform-tools"
```

---

**After completing these steps, try `npx expo run:android` again!**

