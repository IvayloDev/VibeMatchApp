import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DEBUG_TOOLS_ENABLED } from '../debugTools';
import { resetAppToFreshInstall } from '../debugReset';

/**
 * Floating RESET pill: wipes the app back to a true first-run state so the new
 * user flow can be tested repeatedly.
 *
 * This exists because deleting and reinstalling the app does NOT reset it. The
 * free-credit grant marker is keyed to a device id kept in the Keychain, which
 * survives a reinstall, so a reinstalled app comes back as a guest with zero
 * credits and no onboarding. See lib/debugReset.ts.
 *
 * Renders nothing unless DEBUG_TOOLS_ENABLED, which is inlined at build time
 * and never set on the production profile.
 */
const DebugResetButton: React.FC = () => {
  const [working, setWorking] = useState(false);

  if (!DEBUG_TOOLS_ENABLED) return null;

  const confirmReset = () => {
    if (working) return;
    Alert.alert(
      'Reset to a fresh install?',
      'Signs out, clears credits, onboarding, history, taste picks and the device id. The next launch behaves like a brand new install. Force-quit and reopen the app afterwards.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: runReset },
      ]
    );
  };

  const runReset = async () => {
    setWorking(true);
    try {
      const { steps } = await resetAppToFreshInstall();
      Alert.alert(
        'Reset done',
        `${steps.join('\n')}\n\nNow force-quit the app and reopen it. A relaunch is required: the app already holds the old state in memory.`
      );
    } catch (err: any) {
      Alert.alert('Reset failed', err?.message ?? 'Unknown error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.pill}
        onPress={confirmReset}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Debug: reset app to a fresh install"
      >
        {working ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <MaterialCommunityIcons name="restart" size={14} color="#FFFFFF" />
            <Text style={styles.label}>RESET</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 12,
    bottom: 120,
    zIndex: 9999,
    elevation: 9999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 74,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: '#B3261E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  label: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
});

export default DebugResetButton;
