import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, Animated, Dimensions, Pressable, TouchableOpacity, Alert, AppState } from 'react-native';
import { Text } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { getUserCredits } from '../../../lib/credits';
import { hasProEntitlement, subscribeToProStatus } from '../../../lib/revenuecat';
import { canProScanToday, getProScansToday, PRO_DAILY_LIMIT, formatQuotaReset, showsSeconds } from '../../../lib/proQuota';
import { useAuth } from '../../../lib/AuthContext';
import { trackEvent } from '../../../lib/posthog';
import { Colors, Typography, Spacing, Layout, BorderRadius, Shadows } from '../../../lib/designSystem';
import WallSheet from '../../../lib/components/WallSheet';
import { claimDailyCreditIfDue, nextLocalMidnight, formatUntil } from '../../../lib/dailyCredit';
import { registerNotificationOpenedTracking, scheduleFreeMatchReminderIfAllowed } from '../../../lib/notifications';

const { width, height } = Dimensions.get('window');

// Colors from HTML reference - matching AnalyzingScreen
const DesignColors = {
  primary: '#f4258c',
  accentPurple: '#8b5cf6',
  accentTeal: '#2dd4bf',
  backgroundDark: '#221019', // Matching AnalyzingScreen
  backgroundLight: '#f8f5f7',
};

type RootStackParamList = {
  VibeSelection: { image: string };
  Payment: undefined;
  SignUp: undefined;
};

const DashboardScreen = () => {
  const { user } = useAuth();
  const [credits, setCredits] = useState(0);
  const [isPro, setIsPro] = useState(false);
  const [proScansToday, setProScansToday] = useState(0);
  const [loading, setLoading] = useState(true);
  // Out-of-matches wall (replaces the old jump straight into the paywall).
  const [showWall, setShowWall] = useState(false);
  const [wallSource, setWallSource] = useState<'dashboard_cta' | 'dashboard_picker'>('dashboard_cta');
  const [nextFreeAt, setNextFreeAt] = useState<Date>(() => nextLocalMidnight());
  // Ticks once a minute so the "next free match in" countdown stays honest.
  const [, setClockTick] = useState(0);
  // The AppState listener below outlives any single render.
  const userRef = useRef(user);
  userRef.current = user;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  // Loads run one after another: mount, focus and foreground can all fire
  // together, and a plain read racing the daily claim would flash a stale 0.
  const loadChain = useRef<Promise<void>>(Promise.resolve());
  const loadUserCredits = (options?: { claimDaily?: boolean }): Promise<void> => {
    const run = loadChain.current.then(() => loadUserCreditsNow(options));
    loadChain.current = run.catch(() => {});
    return run;
  };

  const loadUserCreditsNow = async (options?: { claimDaily?: boolean }) => {
    try {
      const pro = await hasProEntitlement();
      setIsPro(pro);
      if (options?.claimDaily) {
        // One free match a day, handed out only at a 0 balance (never to Pro).
        const { nextAt } = await claimDailyCreditIfDue(pro, !!userRef.current);
        setNextFreeAt(nextAt);
      }
      const userCredits = await getUserCredits();
      setCredits(userCredits);
      // Refreshed alongside credits so the badge is right after every scan.
      if (pro) setProScansToday(await getProScansToday());
    } catch (error) {
      console.error('Error loading credits:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserCredits({ claimDaily: true });

    // Every foreground is a chance for today's free match to have unlocked.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadUserCredits({ claimDaily: true });
    });

    // notification_opened analytics for every notification tap (App.js is
    // plain JS and stays untouched; the Dashboard mounts once per session).
    const stopOpenedTracking = registerNotificationOpenedTracking();

    // Purchases, renewals and expirations land here live, so the PRO badge
    // and gates flip without a screen re-entry.
    const unsubscribe = subscribeToProStatus(setIsPro);

    // Animate on mount
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      unsubscribe();
      appStateSub.remove();
      stopOpenedTracking();
    };
  }, []);

  // While the countdown is on screen, re-render it every minute and claim the
  // free match the moment 09:00 passes with the app still open.
  // Out of matches: if notifications are already allowed, make sure the
  // "your free match is ready" ping is armed for the next 09:00.
  useEffect(() => {
    if (loading || isPro || credits > 0) return;
    scheduleFreeMatchReminderIfAllowed(nextFreeAt);
  }, [loading, isPro, credits, nextFreeAt]);

  useEffect(() => {
    if (loading || isPro || credits > 0) return;
    // A second inside the last hour, a minute before that: the label only
    // carries seconds near the end.
    const id = setInterval(() => {
      setClockTick((t) => t + 1);
      if (Date.now() >= nextFreeAt.getTime()) loadUserCredits({ claimDaily: true });
    }, showsSeconds(nextFreeAt.getTime() - Date.now()) ? 1000 : 60 * 1000);
    return () => clearInterval(id);
  }, [loading, isPro, credits, nextFreeAt]);

  useFocusEffect(
    React.useCallback(() => {
      loadUserCredits();
    }, [])
  );

  // A free match may have unlocked since the balance was last read (the app
  // can sit in the foreground across the 09:00 reset). True if one was just granted.
  const claimIfUnlocked = async () => {
    const claim = await claimDailyCreditIfDue(false, !!userRef.current);
    setNextFreeAt(claim.nextAt);
    if (claim.granted) await loadUserCredits();
    return claim.granted;
  };

  const openWall = (source: 'dashboard_cta' | 'dashboard_picker') => {
    trackEvent('out_of_credits', { source, credits_balance: credits });
    setWallSource(source);
    setNextFreeAt(nextLocalMidnight());
    setShowWall(true);
  };

  const launchPicker = async () => {
    trackEvent('photo_picker_opened', { source: 'library', credits_balance: credits });
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      trackEvent('photo_selected', { source: 'library' });
      const uri = result.assets[0].uri;
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      navigation.navigate('VibeSelection', { image: manipResult.uri });
    } else {
      // Closed the picker without choosing - the gap between tapping the CTA
      // and a scan ever starting.
      trackEvent('photo_picker_abandoned', { source: 'library' });
    }
  };

  const pickImage = async () => {
    // Pro subscribers with quota left skip the credit gate entirely; the
    // stricter per-scan check (including the daily cap) lives in
    // AnalyzingScreen, which every scan path funnels through.
    const proCanScan = isPro && (await canProScanToday());
    if (!proCanScan && credits < 1) {
      if (isPro) {
        Alert.alert(
          `That's ${PRO_DAILY_LIMIT} for today!`,
          `You've used all of today's matches. A fresh ${PRO_DAILY_LIMIT} unlock in ${formatQuotaReset()}, at 9am.`
        );
        return;
      }
      if (!(await claimIfUnlocked())) {
        openWall('dashboard_picker');
        return;
      }
    }
    launchPicker();
  };

  const handleButtonPress = async () => {
    if (!isPro && credits < 1) {
      // No more paywall jump at 0: the wall says when the next free match
      // lands and offers the cheap pack first.
      if (await claimIfUnlocked()) {
        launchPicker();
        return;
      }
      openWall('dashboard_cta');
    } else {
      pickImage();
    }
  };

  const outOfMatches = !loading && !isPro && credits < 1;

  const handleButtonPressIn = () => {
    Animated.spring(buttonScale, {
      toValue: 0.95,
      useNativeDriver: true,
      friction: 3,
      tension: 300,
    }).start();
  };

  const handleButtonPressOut = () => {
    Animated.spring(buttonScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 3,
      tension: 300,
    }).start();
  };

  return (
    <View style={styles.container}>
      {/* Background Blur Effects */}
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />
      
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View 
            style={[
              styles.header,
              {
                opacity: fadeAnim,
              },
            ]}
          >
            <View style={styles.headerContent}>
              {/* Left: Person Icon */}
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons name="account-circle" size={24} color="#FFFFFF" />
              </View>
              
              {/* Center: TuneMatch Title */}
              <View style={styles.titleContainer}>
                <Text style={styles.appTitle}>TuneMatch</Text>
                <View style={styles.titleUnderline} />
              </View>
              
              {/* Right: PRO badge for subscribers, credits count otherwise.
                  Both open Payment - which shows manage-subscription to pros. */}
              {!loading && (
                <Pressable
                  onPress={() => {
                    if (!isPro) {
                      trackEvent('paywall_cta_tapped', { source: 'dashboard_credits_badge', credits_balance: credits });
                    }
                    navigation.navigate('Payment');
                  }}
                  style={styles.creditsBadge}
                >
                  <View style={styles.creditsTextContainer}>
                    {isPro ? (
                      <>
                        <MaterialCommunityIcons name="crown" size={14} color="#FFD700" />
                        {/* Subscribers were shown only "PRO", with no way to see
                            how much of the daily allowance was left. */}
                        <Text style={styles.creditsText}>
                          {' '}{Math.max(0, PRO_DAILY_LIMIT - proScansToday)}/{PRO_DAILY_LIMIT} TODAY
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.creditsValue}>{credits}</Text>
                        <Text style={styles.creditsText}> CREDITS</Text>
                      </>
                    )}
                  </View>
                </Pressable>
              )}
            </View>
          </Animated.View>

          {/* Main Heading */}
          <Animated.View 
            style={[
              styles.headingContainer,
              {
                opacity: fadeAnim,
              },
            ]}
          >
            <Text style={styles.mainHeading}>
              Match music to your <Text style={styles.gradientText}>mood.</Text>
            </Text>
          </Animated.View>

          {/* Guest monetization: the loud banner sells credits (the paywall is
              where revenue happens); account creation is a quiet secondary line
              underneath rather than the thing we shout about. */}
          {!user && !isPro && (
            <Animated.View style={{ opacity: fadeAnim }}>
              <TouchableOpacity
                style={styles.guestRegisterBanner}
                onPress={() => {
                  trackEvent('paywall_cta_tapped', { source: 'dashboard_banner', credits_balance: credits });
                  navigation.navigate('Payment');
                }}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name={outOfMatches ? 'clock-outline' : 'crown'} size={20} color="#FFFFFF" />
                <View style={styles.guestRegisterTextWrap}>
                  <Text style={styles.guestRegisterTitle}>
                    {outOfMatches
                      ? `Next free match in ${formatUntil(nextFreeAt)}`
                      : 'Go Pro - 10 matches a day'}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.guestRegisterLink}
                onPress={() => {
                  trackEvent('register_cta_tapped', { source: 'dashboard' });
                  navigation.navigate('SignUp');
                }}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              >
                <Text style={styles.guestRegisterLinkText}>
                  or create a free account for 1 bonus credit
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Upload Card */}
          <Animated.View 
            style={[
              styles.uploadCardContainer,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            <Pressable
              onPress={handleButtonPress}
              style={({ pressed }) => [
                styles.uploadCard,
                pressed && styles.uploadCardPressed,
              ]}
            >
              <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={styles.uploadCardContent}>
                {/* Icon Circle */}
                <Animatable.View
                  animation="pulse"
                  iterationCount="infinite"
                  duration={3000}
                  style={styles.iconCircle}
                >
                  <LinearGradient
                    colors={[DesignColors.primary, DesignColors.accentPurple]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.iconCircleGradient}
                  >
                    <MaterialCommunityIcons name="image-plus" size={48} color="#FFFFFF" />
                  </LinearGradient>
                </Animatable.View>

                {/* Card Text */}
                <Text style={styles.uploadTitle}>Upload Your Vibe</Text>
                <Text style={styles.uploadDescription}>
                  {outOfMatches
                    ? `Next free match in ${formatUntil(nextFreeAt)}`
                    : 'Select a photo from your gallery to let AI analyze the mood'}
                </Text>

                {/* CTA Button */}
                <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
                  <TouchableOpacity
                    onPress={handleButtonPress}
                    onPressIn={handleButtonPressIn}
                    onPressOut={handleButtonPressOut}
                    style={styles.ctaButton}
                    activeOpacity={0.9}
                  >
                    <LinearGradient
                      colors={[DesignColors.primary, DesignColors.accentPurple]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.ctaButtonGradient}
                    >
                      <Text style={styles.ctaButtonText}>OPEN GALLERY</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>
              </View>
            </Pressable>
          </Animated.View>

          {/* Progress Indicator */}
          <Animated.View 
            style={[
              styles.progressContainer,
              {
                opacity: fadeAnim,
              },
            ]}
          >
            <View style={styles.progressRow}>
              <View style={styles.progressStep}>
                <View style={styles.progressIcon}>
                  <MaterialCommunityIcons name="image" size={16} color={DesignColors.primary} />
                </View>
                <Text style={styles.progressLabel}>UPLOAD</Text>
              </View>
              <View style={styles.progressLine} />
              <View style={styles.progressStep}>
                <View style={styles.progressIcon}>
                  <MaterialCommunityIcons name="brain" size={16} color={DesignColors.primary} />
                </View>
                <Text style={styles.progressLabel}>ANALYZE</Text>
              </View>
              <View style={styles.progressLine} />
              <View style={styles.progressStep}>
                <View style={styles.progressIcon}>
                  <MaterialCommunityIcons name="music" size={16} color={DesignColors.accentPurple} />
                </View>
                <Text style={styles.progressLabel}>SYNC</Text>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>

      <WallSheet
        visible={showWall}
        source={wallSource}
        credits={credits}
        nextFreeAt={nextFreeAt}
        isAuthenticated={!!user}
        isPro={isPro}
        onClose={() => setShowWall(false)}
        onBoughtPack={(newBalance) => {
          setShowWall(false);
          setCredits(newBalance);
          loadUserCredits();
        }}
        onGoPro={() => {
          setShowWall(false);
          navigation.navigate('Payment');
        }}
        onRegister={() => {
          setShowWall(false);
          navigation.navigate('SignUp');
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DesignColors.backgroundDark,
    position: 'relative',
  },
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100, // Space for bottom tab bar
  },
  backgroundBlur1: {
    position: 'absolute',
    top: -height * 0.1,
    left: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: DesignColors.primary + '20',
    borderRadius: 9999,
    opacity: 0.3,
  },
  backgroundBlur2: {
    position: 'absolute',
    bottom: -height * 0.1,
    right: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: DesignColors.accentPurple + '20',
    borderRadius: 9999,
    opacity: 0.3,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    zIndex: 10,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(40px)',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  titleUnderline: {
    height: 4,
    width: 32,
    backgroundColor: DesignColors.primary,
    borderRadius: 2,
    marginTop: 4,
  },
  creditsBadge: {
    backgroundColor: DesignColors.primary + '20',
    borderWidth: 1,
    borderColor: DesignColors.primary + '30',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
  },
  creditsTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  creditsText: {
    fontSize: 12,
    fontWeight: '700',
    color: DesignColors.primary,
    letterSpacing: 1,
  },
  creditsValue: {
    fontSize: 12,
    fontWeight: '700',
    color: DesignColors.primary,
  },
  headingContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    zIndex: 10,
  },
  mainHeading: {
    // Was 36pt over two lines with a strapline under it, which pushed the
    // upload card off the first screen. This is a returning user's home, not
    // a landing page.
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 31,
    letterSpacing: -0.4,
  },
  gradientText: {
    color: DesignColors.primary, // Using primary red/pink color
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 12,
  },
  guestRegisterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm + 2,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: '#f4258c',
    shadowColor: '#f4258c',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  guestRegisterTextWrap: {
    flex: 1,
  },
  guestRegisterTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  guestRegisterSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    marginTop: 1,
  },
  guestRegisterLink: {
    alignSelf: 'center',
    marginTop: Spacing.sm,
  },
  guestRegisterLinkText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
    textDecorationLine: 'underline',
  },
  uploadCardContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    zIndex: 10,
  },
  uploadCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    overflow: 'hidden',
    minHeight: 280,
  },
  uploadCardPressed: {
    borderColor: DesignColors.primary + '50',
  },
  uploadCardContent: {
    padding: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    ...Shadows.prominent,
  },
  iconCircleGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  uploadTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  uploadDescription: {
    fontSize: 14,
    fontWeight: '400',
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 240,
  },
  ctaButton: {
    minWidth: 200,
    height: 56,
    borderRadius: 9999,
    overflow: 'hidden',
    marginTop: Spacing.md,
    ...Shadows.card,
  },
  ctaButtonGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  progressContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    zIndex: 10,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 320,
    alignSelf: 'center',
  },
  progressStep: {
    flex: 1,
    alignItems: 'center',
  },
  progressIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  progressLine: {
    height: 1,
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 24,
  },
});

export default DashboardScreen;
