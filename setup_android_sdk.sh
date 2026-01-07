#!/bin/bash

# Android SDK Setup Script
# This script sets up the Android SDK and installs required components

set -e

echo "🔧 Setting up Android SDK..."

# Source zshrc to get environment variables
source ~/.zshrc

# Set SDK location
export ANDROID_HOME=$HOME/Library/Android/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME

# Create SDK directory structure
mkdir -p $ANDROID_HOME/cmdline-tools
mkdir -p $ANDROID_HOME/platform-tools

# Check if adb is already installed via Homebrew
if [ -f "/opt/homebrew/bin/adb" ] && [ ! -f "$ANDROID_HOME/platform-tools/adb" ]; then
    echo "🔗 Creating symlink to Homebrew adb..."
    ln -sf /opt/homebrew/bin/adb $ANDROID_HOME/platform-tools/adb
    
    # Also symlink fastboot if it exists
    if [ -f "/opt/homebrew/bin/fastboot" ]; then
        ln -sf /opt/homebrew/bin/fastboot $ANDROID_HOME/platform-tools/fastboot
    fi
    
    # Verify symlink works
    if [ -f "$ANDROID_HOME/platform-tools/adb" ]; then
        echo "✅ Symlink created successfully"
        echo "Skipping SDK manager installation (using Homebrew adb)"
        exit 0
    fi
fi

# Find sdkmanager location
SDKMANAGER_PATH="/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager"

if [ ! -f "$SDKMANAGER_PATH" ]; then
    echo "❌ Error: sdkmanager not found at $SDKMANAGER_PATH"
    echo "Please install android-commandlinetools: brew install --cask android-commandlinetools"
    exit 1
fi

echo "📦 Installing Android SDK components..."
echo "This may take a few minutes..."

# Accept licenses and install components
yes | $SDKMANAGER_PATH --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-33" "build-tools;33.0.0" || {
    echo "⚠️  First attempt failed, trying with different approach..."
    
    # Try alternative: copy cmdline-tools to SDK location
    if [ -d "/opt/homebrew/share/android-commandlinetools/cmdline-tools" ]; then
        echo "📂 Setting up cmdline-tools in SDK directory..."
        cp -r /opt/homebrew/share/android-commandlinetools/cmdline-tools $ANDROID_HOME/
        
        # Try again with local sdkmanager
        yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-33" "build-tools;33.0.0"
    else
        echo "❌ Could not set up SDK. Please install Android Studio or check SDK setup."
        exit 1
    fi
}

# Verify installation
if [ -f "$ANDROID_HOME/platform-tools/adb" ]; then
    echo ""
    echo "✅ Android SDK setup complete!"
    echo ""
    echo "Installed components:"
    echo "  - platform-tools (adb)"
    echo "  - Android Platform 33"
    echo "  - Build Tools 33.0.0"
    echo ""
    echo "SDK Location: $ANDROID_HOME"
    echo ""
    echo "Verify installation:"
    echo "  adb version"
    echo ""
    echo "Now try running: npx expo run:android"
else
    echo "❌ Installation may have failed. Check output above."
    exit 1
fi

