# 🚀 TestFlight Setup Guide

## Prerequisites
- ✅ Apple Developer Account (paid membership required - $99/year)
- ✅ App Store Connect access
- ✅ EAS CLI installed and logged in

---

## Step 1: Install EAS CLI (if not already installed)

```bash
npm install -g eas-cli
```

---

## Step 2: Login to EAS

```bash
eas login
```

Follow the prompts to authenticate with your Expo account.

---

## Step 3: Configure Your Apple Developer Account

### 3.1 Link Your Apple Developer Account to EAS

```bash
eas credentials
```

This will:
- Ask you to select your project
- Guide you through linking your Apple Developer account
- Set up certificates and provisioning profiles automatically

**Note:** EAS will handle all the certificate management for you!

---

## Step 4: Create App in App Store Connect

### 4.1 Go to App Store Connect
1. Visit: https://appstoreconnect.apple.com/
2. Sign in with your Apple Developer account
3. Click **"My Apps"** → **"+"** → **"New App"**

### 4.2 Fill in App Information
- **Platform:** iOS
- **Name:** TuneMatch (or your preferred name)
- **Primary Language:** English (or your preference)
- **Bundle ID:** Select `com.paltech.tunematch` (must match your app.json)
- **SKU:** A unique identifier (e.g., `tunematch-001`)
- **User Access:** Full Access (or Limited Access if you have a team)

### 4.3 Save
Click **"Create"** to create your app in App Store Connect.

**✅ Checkpoint:** App created in App Store Connect

---

## Step 5: Build for TestFlight

### 5.1 Build the iOS App

```bash
eas build --platform ios --profile preview-testflight
```

This will:
- Build your app in the cloud
- Create an `.ipa` file ready for TestFlight
- Take about 10-20 minutes

**Note:** The first build takes longer as EAS sets up your certificates.

### 5.2 Monitor Build Progress

You can check build status:
- In the terminal (it will show progress)
- At: https://expo.dev/accounts/[your-account]/projects/[your-project]/builds

---

## Step 6: Submit to TestFlight

### Option A: Automatic Submission (Recommended)

After the build completes, submit automatically:

```bash
eas submit --platform ios --profile preview-testflight
```

This will:
- Upload your build to App Store Connect
- Process it for TestFlight
- Take about 5-10 minutes

### Option B: Manual Submission

1. Go to App Store Connect → Your App → TestFlight
2. Wait for the build to appear (may take 10-30 minutes)
3. Click **"TestFlight"** tab
4. Your build should appear under "iOS Builds"
5. Click **"Distribute to Testers"** when ready

---

## Step 7: Add TestFlight Testers

### 7.1 Internal Testing (Up to 100 testers)

1. Go to App Store Connect → Your App → TestFlight
2. Click **"Internal Testing"**
3. Click **"+"** to create a group
4. Name it (e.g., "My Team")
5. Add testers by email (they must accept the invitation)
6. Select your build and assign it to the group

### 7.2 External Testing (Up to 10,000 testers)

1. Go to App Store Connect → Your App → TestFlight
2. Click **"External Testing"**
3. Create a group and add testers
4. **Important:** You'll need to fill out:
   - App information
   - What to test
   - Beta App Review information
5. Submit for review (takes 24-48 hours for first external test)

---

## Step 8: Install TestFlight on Your iPhone

### 8.1 Download TestFlight App

1. Open App Store on your iPhone
2. Search for **"TestFlight"**
3. Install the TestFlight app (it's free, made by Apple)

### 8.2 Accept Invitation

1. Check your email for the TestFlight invitation
2. Open the email on your iPhone
3. Tap **"View in TestFlight"** or **"Start Testing"**
4. The app will open in TestFlight
5. Tap **"Accept"** and then **"Install"**

### 8.3 Install Your App

1. Open the TestFlight app on your iPhone
2. You should see your app listed
3. Tap **"Install"**
4. Wait for installation to complete
5. Open the app and test!

---

## Step 9: Testing Your App

Now you can test:
- ✅ Apple Sign-In (should work perfectly!)
- ✅ RevenueCat (native modules work!)
- ✅ All native features
- ✅ Real device performance
- ✅ Push notifications (if configured)

---

## Updating Your App

When you make changes and want to push a new build:

```bash
# Build new version
eas build --platform ios --profile preview-testflight

# Submit to TestFlight
eas submit --platform ios --profile preview-testflight
```

TestFlight will automatically notify testers of new builds!

---

## Troubleshooting

### Build Fails?
- Check that your Apple Developer account is properly linked
- Verify bundle identifier matches App Store Connect
- Check EAS build logs for specific errors

### Can't Find Build in App Store Connect?
- Wait 10-30 minutes for processing
- Check that you're looking at the correct app
- Verify the bundle ID matches

### TestFlight Invitation Not Received?
- Check spam folder
- Verify email address is correct
- Make sure tester has accepted App Store Connect invitation

### App Crashes on Launch?
- Check device logs in Xcode (Window → Devices and Simulators)
- Verify all native modules are properly configured
- Check that you're using a development build profile if needed

---

## Quick Commands Reference

```bash
# Build for TestFlight
eas build --platform ios --profile preview-testflight

# Submit to TestFlight
eas submit --platform ios --profile preview-testflight

# Check build status
eas build:list

# View credentials
eas credentials

# Update EAS CLI
npm install -g eas-cli@latest
```

---

## Next Steps

Once TestFlight is working:
1. ✅ Test all features on your physical device
2. ✅ Invite beta testers
3. ✅ Gather feedback
4. ✅ Fix any issues
5. ✅ Prepare for App Store submission!

---

**Need Help?** Check the EAS documentation: https://docs.expo.dev/build/introduction/

