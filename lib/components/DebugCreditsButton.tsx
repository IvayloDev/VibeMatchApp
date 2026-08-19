import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getLocalCredits,
  addLocalCredits,
  getUserCredits,
  updateUserCredits,
} from '../credits';
import { useAuth } from '../AuthContext';
import { DEBUG_TOOLS_ENABLED } from '../debugTools';
import { resetAppToFreshInstall } from '../debugReset';

/**
 * Floating "+1 credit" button for testing.
 *
 * Reinstalling the app does NOT hand back the free guest credit: the grant
 * marker in lib/utils/freeCredits.ts is keyed to a Keychain device id
 * precisely so a reinstall cannot farm credits. That is correct for real
 * users and a genuine obstacle when testing the out-of-credits and paywall
 * paths repeatedly, which is what this exists for.
 *
 * Tap: +1 credit. Long-press: set the balance to 0, to test the empty state.
 * Routes to local storage for guests and to the profile row for signed-in
 * users, so the number it changes is the same one the gates read.
 *
 * Compiled out of App Store builds - see DEBUG_TOOLS_ENABLED.
 */
const DebugCreditsButton: React.FC = () => {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [credits, setCredits] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const isAuthenticated = !!user;

  const readCredits = useCallback(async () => {
    try {
      const value = isAuthenticated ? await getUserCredits() : await getLocalCredits();
      setCredits(value);
    } catch {
      setCredits(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    readCredits();
    // Cheap poll so the pill still reflects credits spent elsewhere in the app.
    const id = setInterval(readCredits, 3000);
    return () => clearInterval(id);
  }, [readCredits]);

  const grant = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isAuthenticated) {
        const current = await getUserCredits();
        await updateUserCredits(current + 1);
      } else {
        await addLocalCredits(1);
      }
      await readCredits();
    } finally {
      setBusy(false);
    }
  };

  const zero = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isAuthenticated) {
        await updateUserCredits(0);
      } else {
        const current = await getLocalCredits();
        if (current > 0) await addLocalCredits(-current);
      }
      await readCredits();
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = () => {
    Alert.alert(
      'Reset app?',
      'Wipes credits, history, onboarding, Spotify link and the free-credit marker, and signs out. The app must be fully closed and reopened afterwards.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: runReset },
      ]
    );
  };

  const runReset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { steps } = await resetAppToFreshInstall();
      await readCredits();
      Alert.alert(
        'Reset done',
        `${steps.join('\n')}\n\nNow fully quit and reopen the app - onboarding and the free credit are decided at launch.`
      );
    } catch (error: any) {
      Alert.alert('Reset failed', error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.wrap, { top: insets.top + 4 }]} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.pill}
        onPress={grant}
        onLongPress={zero}
        delayLongPress={600}
        activeOpacity={0.7}
        disabled={busy}
      >
        <Text style={styles.text}>
          DEBUG +1{credits === null ? '' : `  (${credits})`}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.pill, styles.resetPill]}
        onPress={confirmReset}
        activeOpacity={0.7}
        disabled={busy}
      >
        <Text style={[styles.text, styles.resetText]}>
          {busy ? '...' : 'RESET'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 8,
    flexDirection: 'row',
    gap: 6,
    zIndex: 9999,
    elevation: 9999,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,193,7,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  resetPill: {
    backgroundColor: 'rgba(255,59,48,0.92)',
  },
  resetText: {
    color: '#FFFFFF',
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1A1A1A',
    fontVariant: ['tabular-nums'],
  },
});

/**
 * Renders nothing at all when the tools are off, so callers can mount it
 * unconditionally and App Store builds carry an inert component.
 */
const DebugCreditsButtonGate: React.FC = () =>
  DEBUG_TOOLS_ENABLED ? <DebugCreditsButton /> : null;

export default DebugCreditsButtonGate;
