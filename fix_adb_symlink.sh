#!/bin/bash

# Quick fix: Create symlink from SDK platform-tools to Homebrew adb

set -e

echo "🔧 Fixing adb symlink..."

ANDROID_HOME=$HOME/Library/Android/sdk
ADB_BREW="/opt/homebrew/bin/adb"
ADB_SDK="$ANDROID_HOME/platform-tools/adb"

# Create directory if it doesn't exist
mkdir -p "$ANDROID_HOME/platform-tools"

# Create symlink
if [ -f "$ADB_BREW" ]; then
    echo "Creating symlink: $ADB_SDK -> $ADB_BREW"
    ln -sf "$ADB_BREW" "$ADB_SDK"
    
    # Also symlink fastboot if it exists
    if [ -f "/opt/homebrew/bin/fastboot" ]; then
        ln -sf /opt/homebrew/bin/fastboot "$ANDROID_HOME/platform-tools/fastboot"
    fi
    
    # Verify
    if [ -f "$ADB_SDK" ]; then
        echo "✅ Success! adb is now available at: $ADB_SDK"
        echo ""
        echo "Testing adb:"
        "$ADB_SDK" version
        echo ""
        echo "✅ You can now run: npx expo run:android"
    else
        echo "❌ Failed to create symlink"
        exit 1
    fi
else
    echo "❌ Error: adb not found at $ADB_BREW"
    echo "Please install android-platform-tools: brew install android-platform-tools"
    exit 1
fi

