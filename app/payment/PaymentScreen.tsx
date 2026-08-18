import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PurchasesOffering, CustomerInfo } from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';
import {
  getProOffering,
  hasProEntitlement,
  refreshProStatus,
  getCustomerInfo,
  getManagementURL,
  restorePurchases,
  PRO_ENTITLEMENT_ID,
} from '../../lib/revenuecat';
import { getProScansToday, PRO_DAILY_LIMIT } from '../../lib/proQuota';
import { getUserCredits, getLocalCredits } from '../../lib/credits';
import { loadGuestHistory } from '../../lib/guestHistory';
import { supabase } from '../../lib/supabase';
import { trackEvent } from '../../lib/posthog';
import { Spacing, BorderRadius } from '../../lib/designSystem';
import { triggerHaptic } from '../../lib/utils/haptics';
import { useAuth } from '../../lib/AuthContext';

const DesignColors = {
  primary: '#f4258c',
  accentPurple: '#8b5cf6',
  backgroundDark: '#221019',
};

type ScreenState = 'loading' | 'entitled' | 'paywall' | 'error';

/**
 * Matches this person has actually made, remote rows plus anything still in the
 * guest cache (guest matches never reach the `history` table - the insert needs
 * a user id). Used only to show real progress on the paywall, so any failure
 * degrades to 0 and the strip simply does not render.
 */
async function countMatchesMade(isAuthenticated: boolean): Promise<number> {
  let remote = 0;
  if (isAuthenticated) {
    try {
      const { count } = await supabase
        .from('history')
        .select('id', { count: 'exact', head: true });
      remote = count ?? 0;
    } catch {
      remote = 0;
    }
  }

  let local = 0;
  try {
    local = (await loadGuestHistory()).length;
  } catch {
    local = 0;
  }

  return remote + local;
}

/**
 * Subscription paywall. The purchase UI itself is RevenueCat's remotely
 * configured Paywall ("TuneMatch Pro v1" on the pro_v1 offering) embedded
 * below a thin native header; this screen owns loading/entitled/error chrome,
 * analytics, and navigation. Legacy credit-pack purchasing (validate-purchase,
 * local credit grants, mock packages, the 30-min launch offer) is gone - old
 * builds keep their own copy of that flow against the untouched `default`
 * offering.
 */
const PaymentScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [currentCredits, setCurrentCredits] = useState<number>(0);
  const [proScansToday, setProScansToday] = useState<number>(0);
  const [matchesMade, setMatchesMade] = useState<number>(0);
  const paywallTracked = useRef(false);

  const loadData = useCallback(async () => {
    setScreenState('loading');

    const credits = isAuthenticated ? await getUserCredits() : await getLocalCredits();
    setCurrentCredits(credits);

    if (!paywallTracked.current) {
      paywallTracked.current = true;
      trackEvent('paywall_viewed', {
        credits_balance: credits,
        is_out_of_credits: credits === 0,
        is_authenticated: isAuthenticated,
        paywall_type: 'subscription',
      });
    }

    // Already-subscribed users get a manage screen, not a sales pitch.
    if (await hasProEntitlement()) {
      setProScansToday(await getProScansToday());
      setScreenState('entitled');
      return;
    }

    const [proOffering, matches] = await Promise.all([
      getProOffering(),
      countMatchesMade(isAuthenticated),
    ]);
    setMatchesMade(matches);

    if (proOffering) {
      setOffering(proOffering);
      setScreenState('paywall');
    } else {
      // Honest failure state. The old screen showed fake packages here whose
      // Buy button dead-ended - that path is deliberately dead.
      trackEvent('paywall_packages_unavailable', {
        reason: 'offering_missing',
        is_authenticated: isAuthenticated,
      });
      setScreenState('error');
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const goBack = () => (navigation as any).goBack();

  const navigateToSignUp = () => {
    trackEvent('register_cta_tapped', { source: 'paywall' });
    navigation.dispatch(CommonActions.navigate({ name: 'SignUp' }));
  };

  const handleManageSubscription = async () => {
    try {
      await RevenueCatUI.presentCustomerCenter();
      // Status may have changed (cancellation, refund request) - refresh.
      refreshProStatus().catch(() => {});
    } catch {
      // Customer Center unavailable - deep-link to the store's management page.
      const info = await getCustomerInfo();
      const url = info ? getManagementURL(info) : null;
      if (url) {
        Linking.openURL(url).catch(() => {});
      } else {
        Alert.alert('Manage Subscription', 'Open your device Settings > Subscriptions to manage your plan.');
      }
    }
  };

  const handleRestore = async () => {
    const result = await restorePurchases();
    if (result.success && result.customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT_ID]) {
      await refreshProStatus(result.customerInfo);
      trackEvent('subscription_restored', { is_authenticated: isAuthenticated });
      triggerHaptic('success');
      Alert.alert('Restored', 'Your TuneMatch Pro subscription is active again.', [
        { text: 'OK', onPress: goBack },
      ]);
    } else {
      Alert.alert('Nothing to Restore', 'No active subscription was found for this account.');
    }
  };

  const handlePurchaseCompleted = async ({ customerInfo, storeTransaction }: {
    customerInfo: CustomerInfo;
    storeTransaction: { productIdentifier?: string } | null;
  }) => {
    await refreshProStatus(customerInfo);
    const entitlement = customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT_ID];
    const productId = storeTransaction?.productIdentifier
      ?? entitlement?.productIdentifier
      ?? 'unknown';
    const isTrial = entitlement?.periodType === 'TRIAL';

    trackEvent('purchase_completed', {
      product_id: productId,
      paywall_type: 'subscription',
      is_authenticated: isAuthenticated,
    });
    trackEvent('subscription_started', {
      product_id: productId,
      is_trial: isTrial,
      is_authenticated: isAuthenticated,
    });

    triggerHaptic('success');
    goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.closeButton}>
          <MaterialCommunityIcons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text style={styles.headerSubtitle}>TUNEMATCH</Text>
          <Text style={styles.headerMainTitle}>TuneMatch Pro</Text>
        </View>
        {currentCredits > 0 ? (
          <View style={styles.creditsPill}>
            <MaterialCommunityIcons name="lightning-bolt" size={14} color={DesignColors.primary} />
            <Text style={styles.creditsPillText}>{currentCredits}</Text>
          </View>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {screenState === 'loading' && (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={DesignColors.primary} />
        </View>
      )}

      {screenState === 'entitled' && (
        <View style={styles.centerContent}>
          <View style={styles.proBadge}>
            <MaterialCommunityIcons name="crown" size={42} color="#FFD700" />
          </View>
          <Text style={styles.proTitle}>You're Pro</Text>
          <Text style={styles.proSubtitle}>
            {Math.max(0, PRO_DAILY_LIMIT - proScansToday)} of {PRO_DAILY_LIMIT} matches left today
          </Text>
          {currentCredits > 0 && (
            <Text style={styles.proCreditsNote}>
              Plus {currentCredits} bonus credit{currentCredits === 1 ? '' : 's'} if you ever need more
            </Text>
          )}
          <TouchableOpacity style={styles.manageButton} onPress={handleManageSubscription}>
            <Text style={styles.manageButtonText}>Manage Subscription</Text>
          </TouchableOpacity>
        </View>
      )}

      {screenState === 'error' && (
        <View style={styles.centerContent}>
          <MaterialCommunityIcons name="cloud-off-outline" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={styles.errorTitle}>Plans couldn't be loaded</Text>
          <Text style={styles.errorSubtitle}>Check your connection and try again.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadData}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRestore} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.restoreLink}>Restore Purchases</Text>
          </TouchableOpacity>
        </View>
      )}

      {screenState === 'paywall' && offering && (
        <View style={styles.paywallWrap}>
          {/*
            Real progress, not decoration: the numerator is matches this person
            has actually made and the denominator is what a single Pro day gives
            them. Someone who has never matched anything sees nothing, because
            there is no progress to show. The fill is floored so a first match
            still reads as a visible sliver rather than an empty bar.
          */}
          {matchesMade > 0 && (
            <View style={styles.progressCard}>
              <View style={styles.progressRow}>
                <Text style={styles.progressLabel}>
                  {matchesMade} match{matchesMade === 1 ? '' : 'es'} made
                </Text>
                <Text style={styles.progressCount}>{matchesMade} / {PRO_DAILY_LIMIT}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(100, Math.max(8, (matchesMade / PRO_DAILY_LIMIT) * 100))}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressHint}>
                Pro gives you {PRO_DAILY_LIMIT} matches every day.
              </Text>
            </View>
          )}
          <RevenueCatUI.Paywall
            style={styles.paywall}
            options={{ offering, displayCloseButton: false }}
            onPurchaseStarted={({ packageBeingPurchased }: any) => {
              trackEvent('purchase_started', {
                product_id: packageBeingPurchased?.product?.identifier,
                package_id: packageBeingPurchased?.identifier,
                paywall_type: 'subscription',
                credits_balance: currentCredits,
                is_authenticated: isAuthenticated,
              });
            }}
            onPurchaseCompleted={handlePurchaseCompleted}
            onPurchaseCancelled={() => {
              trackEvent('purchase_cancelled', {
                paywall_type: 'subscription',
                credits_balance: currentCredits,
              });
            }}
            onPurchaseError={({ error }: any) => {
              trackEvent('purchase_failed', {
                paywall_type: 'subscription',
                error: error?.message ?? String(error),
              });
            }}
            onRestoreCompleted={async ({ customerInfo }: { customerInfo: CustomerInfo }) => {
              const isPro = await refreshProStatus(customerInfo);
              if (isPro) {
                trackEvent('subscription_restored', { is_authenticated: isAuthenticated });
                triggerHaptic('success');
                goBack();
              } else {
                Alert.alert('Nothing to Restore', 'No active subscription was found for this account.');
              }
            }}
            onDismiss={goBack}
          />
          {!isAuthenticated && (
            <TouchableOpacity
              style={styles.registerLink}
              onPress={navigateToSignUp}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            >
              <Text style={styles.registerLinkText}>
                or create a free account for 1 bonus credit
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DesignColors.backgroundDark,
  },
  backgroundBlur1: {
    position: 'absolute',
    top: -120,
    left: -80,
    width: 300,
    height: 300,
    borderRadius: 9999,
    backgroundColor: DesignColors.primary + '20',
    opacity: 0.3,
  },
  backgroundBlur2: {
    position: 'absolute',
    bottom: -120,
    right: -80,
    width: 300,
    height: 300,
    borderRadius: 9999,
    backgroundColor: DesignColors.accentPurple + '20',
    opacity: 0.3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    alignItems: 'center',
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: DesignColors.primary,
    letterSpacing: 2,
  },
  headerMainTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSpacer: {
    width: 40,
  },
  creditsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  creditsPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  proBadge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  proTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  proSubtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
  },
  proCreditsNote: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  manageButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  manageButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: Spacing.sm,
  },
  errorSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl * 1.5,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: DesignColors.primary,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  restoreLink: {
    marginTop: Spacing.md,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    textDecorationLine: 'underline',
  },
  paywallWrap: {
    flex: 1,
  },
  progressCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  progressCount: {
    fontSize: 12,
    fontWeight: '600',
    color: DesignColors.primary,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: DesignColors.primary,
  },
  progressHint: {
    marginTop: Spacing.sm,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
  },
  paywall: {
    flex: 1,
  },
  registerLink: {
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
  },
  registerLinkText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
    textDecorationLine: 'underline',
  },
});

export default PaymentScreen;
