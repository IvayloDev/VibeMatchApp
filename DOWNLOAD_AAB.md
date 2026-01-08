# Download AAB for Internal Testing

## ✅ Build Completed!

Your AAB has been built successfully. Build details:
- **Build Number:** 8 (versionCode: 8)
- **Profile:** preview (for internal testing)
- **Platform:** Android

## 📥 Download the AAB

### Option 1: Download from EAS Dashboard (Recommended)

1. **Go to your build:**
   - Visit: https://expo.dev/accounts/ivaylop/projects/tunematch/builds
   - Or click the build link from the terminal output

2. **Download the AAB:**
   - Click on the latest build
   - Click **"Download"** button
   - The file will be named something like: `tunematch-1.0.0-8-preview.aab`

### Option 2: Download via EAS CLI

Run this command to download the latest build:

```bash
npx eas-cli build:list --platform android --limit 1
```

Then download using:
```bash
npx eas-cli build:download --latest --platform android
```

This will download the AAB file to your current directory.

## 📤 Upload to Google Play Console

Once you have the AAB file:

1. **Go to Google Play Console:**
   - https://play.google.com/console
   - Select your app: **TuneMatch**

2. **Go to Testing → Internal testing:**
   - Create a new release (or update existing)
   - Upload the AAB file you downloaded

3. **Review and publish:**
   - Complete the release details
   - Add release notes if needed
   - Publish to internal testing track

## 📋 Build Information

- **Bundle ID:** com.paltech.tunematch
- **Version Code:** 8
- **Version Name:** 1.0.0
- **Build Type:** AAB (Android App Bundle)

## 🎯 Next Steps

1. Download the AAB from EAS
2. Upload to Google Play Console → Internal Testing
3. Test on real devices via internal testing track

