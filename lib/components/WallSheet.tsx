import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Animated,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';
import {
  getStarterPackPackage,
  purchaseCreditPackage,
  CREDITS_PER_PRODUCT,
  STARTER_PACK_PRODUCT_ID,
} from '../revenuecat';
import { validatePurchaseWithRetry } from '../supabase';
import { storePendingValidation } from '../credits';
import { bootstrapSession } from '../identity';
import { scheduleFreeMatchReminder } from '../notifications';
import { formatUntil } from '../dailyCredit';
import { trackEvent } from '../posthog';
import { triggerHaptic } from '../utils/haptics';

// Brand palette (matches the onboarding / results screens).
const C = {
  card: '#1B0E17',
  primary: '#f4258c',
  purple: '#8b5cf6',
  white: '#FFFFFF',
  dim: 'rgba(255,255,255,0.60)',
  faint: 'rgba(255,255,255,0.40)',
  border: 'rgba(255,255,255,0.10)',
  surface: 'rgba(255,255,255,0.06)',
};

export type WallSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Where the wall came up: dashboard_cta, dashboard_picker, vibe_selection, analyzing_gate. */
  source: string;
  credits: number;
  nextFreeAt: Date;
  onBoughtPack: (newBalance: number) => void;
  onGoPro: () => void;
  onRegister: () => void;
  isAuthenticated: boolean;
  isPro: boolean;
};

type PackState = 'loading' | 'ready' | 'unavailable';
type ReminderState = 'idle' | 'working' | 'set' | 'blocked';

/**
 * The out-of-matches wall. Replaces the jump straight into the full-screen
 * subscription paywall at 0 credits, which nobody converted from. Leads with
 * the fact that a free match is coming, then the cheap pack, then Pro.
 *
 * The pack purchase happens right here (same grant flow as the Payment
 * screen's starter pack): signed-in users are validated server-side, guests
 * get local credits per Apple 5.1.1.
 */
export default function WallSheet({
  visible,
  onClose,
  source,
  credits,
  nextFreeAt,
  onBoughtPack,
  onGoPro,
  onRegister,
  isAuthenticated,
  isPro,
}: WallSheetProps) {
  const insets = useSafeAreaInsets();
  const [pack, setPack] = useState<PurchasesPackage | null>(null);
  const [packState, setPackState] = useState<PackState>('loading');
  const [buying, setBuying] = useState(false);
  const [reminder, setReminder] = useState<ReminderState>('idle');
  const translateY = useRef(new Animated.Value(320)).current;
  const shownAt = useRef<number>(Date.now());

  const secondsSince = (t: number | null) => (t ? Math.round((Date.now() - t) / 1000) : null);

  useEffect(() => {
    if (!visible) return;

    shownAt.current = Date.now();
    setReminder('idle');
    translateY.setValue(320);
    Animated.spring(translateY, {
      toValue: 0,
      friction: 9,
      tension: 70,
      useNativeDriver: true,
    }).start();

    trackEvent('wall_sheet_shown', {
      source,
      credits,
      next_free_in_min: Math.max(0, Math.round((nextFreeAt.getTime() - Date.now()) / 60000)),
      is_authenticated: isAuthenticated,
    });

    let cancelled = false;
    setPackState('loading');
    getStarterPackPackage()
      .then((pkg) => {
        if (cancelled) return;
        setPack(pkg);
        setPackState(pkg ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (cancelled) return;
        setPack(null);
        setPackState('unavailable');
      });
    return () => {
      cancelled = true;
    };
    // Re-run only when the sheet opens; the other props are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleBuyPack = async () => {
    if (!pack || buying) return;
    triggerHaptic('medium');
    setBuying(true);

    const productId = pack.product.identifier;
    const packageId = pack.identifier;
    const startedAt = Date.now();
    trackEvent('paywall_cta_tapped', { source: 'wall_sheet_pack', credits_balance: credits });
    trackEvent('purchase_started', {
      product_id: productId,
      package_id: packageId,
      paywall_type: 'credit_pack',
      credits_balance: credits,
      is_authenticated: isAuthenticated,
      seconds_on_paywall: secondsSince(shownAt.current),
      source: 'wall_sheet',
    });

    try {
      const result = await purchaseCreditPackage(pack);

      if (result.userCancelled) {
        trackEvent('purchase_cancelled', {
          product_id: productId,
          package_id: packageId,
          paywall_type: 'credit_pack',
          credits_balance: credits,
          is_authenticated: isAuthenticated,
          seconds_since_start: secondsSince(startedAt),
          source: 'wall_sheet',
        });
        return;
      }
      if (!result.success || !result.transactionId || !result.productId) {
        trackEvent('purchase_failed', {
          product_id: productId,
          package_id: packageId,
          paywall_type: 'credit_pack',
          error: result.error ?? 'unknown',
          error_code: result.errorCode,
          underlying: result.underlying,
          is_authenticated: isAuthenticated,
          seconds_since_start: secondsSince(startedAt),
          source: 'wall_sheet',
        });
        triggerHaptic('error');
        Alert.alert('Purchase Failed', result.error || 'Please try again.');
        return;
      }

      // Play reports the bare product id; App Store may too. Never grant 0.
      const granted = CREDITS_PER_PRODUCT[result.productId]
        ?? CREDITS_PER_PRODUCT[STARTER_PACK_PRODUCT_ID];
      let newBalance = credits + granted;

      // Everyone validates. There is no longer a guest branch that writes
      // credits straight into AsyncStorage without a receipt check, a
      // purchases row, or any record on the server that the sale happened.
      // Every install has an identity, so every purchase can be verified
      // against RevenueCat and granted by the server exactly once.
      {
        const validation = await validatePurchaseWithRetry(result.transactionId, result.productId, 3);
        if (validation.success && validation.creditsGranted) {
          newBalance = validation.newBalance ?? credits + validation.creditsGranted;
        } else {
          // Charged but not yet granted - queue it; the Pro screen retries
          // queued validations the next time it opens. Say so plainly.
          await storePendingValidation(result.transactionId, result.productId, granted);
          triggerHaptic('warning');
          Alert.alert(
            'Purchase received',
            "We couldn't confirm the purchase with our server yet. Your matches will be added the next time you open the Pro screen.",
            [{ text: 'OK', onPress: onClose }]
          );
          return;
        }
      }

      trackEvent('purchase_completed', {
        product_id: result.productId,
        paywall_type: 'credit_pack',
        credits_granted: granted,
        credits_balance: newBalance,
        is_authenticated: isAuthenticated,
        seconds_since_start: secondsSince(startedAt),
        source: 'wall_sheet',
      });
      triggerHaptic('success');
      // The server granted this; ask it for the resulting state rather than
      // trusting the arithmetic done here.
      await bootstrapSession();
      onBoughtPack(newBalance);
    } catch (error: any) {
      trackEvent('purchase_failed', {
        product_id: productId,
        package_id: packageId,
        paywall_type: 'credit_pack',
        error: error?.message ?? 'exception',
        is_authenticated: isAuthenticated,
        seconds_since_start: secondsSince(startedAt),
        source: 'wall_sheet',
      });
      triggerHaptic('error');
      Alert.alert('Error', 'Unable to complete purchase. Please try again.');
    } finally {
      setBuying(false);
    }
  };

  const handleGoPro = () => {
    trackEvent('paywall_cta_tapped', { source: 'wall_sheet_pro', credits_balance: credits });
    onGoPro();
  };

  const handleRemind = async () => {
    if (reminder !== 'idle') return;
    trackEvent('wall_reminder_tapped', { source, next_at: nextFreeAt.toISOString() });
    setReminder('working');
    const ok = await scheduleFreeMatchReminder(nextFreeAt);
    setReminder(ok ? 'set' : 'blocked');
    if (ok) triggerHaptic('light');
  };

  const handleRegister = () => {
    trackEvent('register_cta_tapped', { source: 'wall_sheet' });
    onRegister();
  };

  const packCredits = CREDITS_PER_PRODUCT[STARTER_PACK_PRODUCT_ID];

  const reminderLabel = {
    idle: 'Remind me when it unlocks',
    working: 'Setting reminder...',
    set: "We'll tell you",
    blocked: 'Notifications are off for TuneMatch',
  }[reminder];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 12) + 12, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.grabber} />

          <Text style={styles.title}>Out of matches for today</Text>
          <Text style={styles.subtitle}>
            Your free match unlocks in {formatUntil(nextFreeAt)}
          </Text>

          {/* Primary: the cheap pack. Hidden until the store can quote a price. */}
          {packState === 'loading' && (
            <View style={styles.packPlaceholder}>
              <ActivityIndicator size="small" color={C.dim} />
            </View>
          )}
          {packState === 'ready' && pack && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleBuyPack}
              disabled={buying}
              style={styles.primaryBtn}
            >
              <LinearGradient
                colors={[C.primary, C.purple]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryGradient}
              >
                {buying ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="lightning-bolt" size={18} color="#FFF" />
                    <Text style={styles.primaryText}>
                      {packCredits} matches for {pack.product.priceString}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          )}
          {packState === 'unavailable' && (
            <View style={styles.packPlaceholder}>
              <MaterialCommunityIcons name="cloud-off-outline" size={14} color={C.faint} />
              <Text style={styles.storeNote}>Store unavailable</Text>
            </View>
          )}

          {/* Secondary: Pro. Parent navigates to Payment. */}
          {!isPro && (
            <TouchableOpacity activeOpacity={0.8} onPress={handleGoPro} style={styles.secondaryBtn}>
              <MaterialCommunityIcons name="crown" size={18} color="#FFD700" />
              <Text style={styles.secondaryText}>TuneMatch Pro - 10 a day</Text>
            </TouchableOpacity>
          )}

          {/* Reminder for the free match. */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleRemind}
            disabled={reminder !== 'idle'}
            style={styles.reminderRow}
          >
            <MaterialCommunityIcons
              name={reminder === 'set' ? 'bell-check' : reminder === 'blocked' ? 'bell-off-outline' : 'bell-outline'}
              size={18}
              color={reminder === 'set' ? '#2dd4bf' : C.dim}
            />
            <Text style={[styles.reminderText, reminder === 'set' && styles.reminderTextSet]}>
              {reminderLabel}
            </Text>
          </TouchableOpacity>

          {!isAuthenticated && (
            <TouchableOpacity
              onPress={handleRegister}
              style={styles.registerLink}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            >
              <Text style={styles.registerLinkText}>Create an account for 1 bonus credit</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: C.border,
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 20,
  },
  title: {
    color: C.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    color: C.dim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },
  primaryBtn: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  primaryGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    minHeight: 52,
  },
  primaryText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  packPlaceholder: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  storeNote: {
    color: C.faint,
    fontSize: 12,
    fontWeight: '500',
  },
  secondaryBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryText: {
    color: C.white,
    fontSize: 15,
    fontWeight: '600',
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 6,
  },
  reminderText: {
    color: C.dim,
    fontSize: 14,
    fontWeight: '600',
  },
  reminderTextSet: {
    color: '#2dd4bf',
  },
  registerLink: {
    paddingVertical: 6,
  },
  registerLinkText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
    textDecorationLine: 'underline',
  },
});
