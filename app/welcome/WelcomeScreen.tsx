import React, { useState, useEffect, useRef } from 'react';
import { isSpotifyConnectEnabled } from '../../lib/featureFlags';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Linking,
  TouchableOpacity,
  Animated,
  AccessibilityInfo,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as SecureStore from 'expo-secure-store';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { grantGuestFreeCredits } from '../../lib/utils/freeCredits';
import { useAuth } from '../../lib/AuthContext';
import { HAD_ACCOUNT_KEY } from '../../lib/AuthContext';
import { getSpotifyConnectionStatus } from '../../lib/spotify';
import { trackEvent } from '../../lib/posthog';
import { Spacing } from '../../lib/designSystem';
import { OB, OnboardingFooter } from '../../lib/components/OnboardingChrome';

// Define the navigation stack param list
type RootStackParamList = {
  Welcome: undefined;
  SignUp: undefined;
  SignIn: undefined;
  ConnectSpotify: undefined;
  TastePicker: { returnTo?: 'back' } | undefined;
  Onboarding: undefined;
  MainTabs: undefined;
};

const PRIVACY_POLICY_URL = 'https://ivaylodev.github.io/vibematch-privacy-policy/';

const { width, height } = Dimensions.get('window');

// Hero: three stylized "match cards" fanned in a stack. Each is a gradient
// cover with a vibe tag and a song pill, so the screen shows the result of
// a match before asking for a tap. The front card rotates every few seconds.
const CARD_SIZE = 196;
const CARD_SPREAD = 70;
const STACK_WIDTH = CARD_SIZE + CARD_SPREAD * 2;
const STACK_HEIGHT = CARD_SIZE + 32;
const SWAP_EVERY_MS = 3000;
const SWAP_DURATION_MS = 400;

type Gradient = readonly [string, string, string];

interface MatchCardSpec {
  tag: string;
  gradient: Gradient;
  song: string;
  artist: string;
}

// Index 0 starts in front; the next index sits back-left, the one after
// back-right. Rotation advances the front by one each swap.
const MATCH_CARDS: MatchCardSpec[] = [
  { tag: 'Romantic', gradient: ['#ffb36b', '#f4258c', '#4a1d6e'], song: 'Golden Hour', artist: 'JVKE' },
  { tag: 'Chill', gradient: ['#1de9b6', '#1c7ed6', '#0b1a3a'], song: 'Weightless', artist: 'Marconi Union' },
  { tag: 'Moody', gradient: ['#8b5cf6', '#2a1444', '#0f0a1c'], song: 'Nightcall', artist: 'Kavinsky' },
];

const MatchCard = ({ card }: { card: MatchCardSpec }) => (
  <LinearGradient colors={card.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
    <View style={styles.tag}>
      <Text style={styles.tagText}>{card.tag}</Text>
    </View>
    <View style={styles.pill}>
      <View style={styles.playDot}>
        <MaterialCommunityIcons name="play" size={16} color={OB.text} />
      </View>
      <View style={styles.pillCopy}>
        <Text style={styles.song} numberOfLines={1}>
          {card.song}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {card.artist}
        </Text>
      </View>
    </View>
  </LinearGradient>
);

// One position in the stack. Two cards are layered: the one underneath is
// always fully opaque and the one on top fades, so a swap is a single fade
// with no background bleeding through mid-crossfade. Which card sits on top
// alternates each step so the shared Animated.Value never has to be reset
// (resetting it in the same tick as a state change can flash a frame).
type CardSlotProps = {
  current: MatchCardSpec;
  next: MatchCardSpec;
  topIsCurrent: boolean;
  topOpacity: Animated.AnimatedInterpolation<number>;
  style: StyleProp<ViewStyle>;
  lift?: Animated.AnimatedInterpolation<number>;
};

const CardSlot = ({ current, next, topIsCurrent, topOpacity, style, lift }: CardSlotProps) => {
  const top = topIsCurrent ? current : next;
  const under = topIsCurrent ? next : current;
  return (
    <Animated.View style={[styles.slot, style, lift ? { transform: [{ translateY: lift }] } : null]}>
      <View style={StyleSheet.absoluteFill}>
        <MatchCard card={under} />
      </View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: topOpacity }]}>
        <MatchCard card={top} />
      </Animated.View>
    </Animated.View>
  );
};

const WelcomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, loading, spotifyConnected } = useAuth();
  const [starting, setStarting] = useState(false);
  // Only returning (previously signed-in) users see a sign-in affordance;
  // brand-new users get a pure Start Matching screen.
  const [hadAccount, setHadAccount] = useState(false);

  // Hero rotation: step counts completed swaps. step % 3 picks the front
  // card, step % 2 picks which layer of each slot is on top.
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const swap = useRef(new Animated.Value(0)).current;

  // Single entrance fade for the whole screen
  const enter = useRef(new Animated.Value(0)).current;

  // Detect a returning-but-logged-out user to conditionally reveal Sign in
  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(HAD_ACCOUNT_KEY)
      .then((v) => {
        if (active && v === 'true') setHadAccount(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [enter]);

  // Swap the front card every few seconds. Skipped entirely when the user
  // has asked for reduced motion, leaving a static stack.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
      const toValue = stepRef.current % 2 === 0 ? 1 : 0;
      Animated.timing(swap, {
        toValue,
        duration: SWAP_DURATION_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || !active) return;
        stepRef.current += 1;
        setStep(stepRef.current);
      });
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (!active || reduceMotion) return;
        timer = setInterval(tick, SWAP_EVERY_MS);
      });

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      swap.stopAnimation();
    };
  }, [swap]);

  // Redirect if user is already logged in: Spotify gate first, then MainTabs
  useEffect(() => {
    console.log('[Welcome] auth effect - loading:', loading, 'user:', !!user, 'spotifyConnected:', spotifyConnected);
    if (!loading && user) {
      // The Spotify prompt only shows when the remote flag is on for this user.
      const dest = (spotifyConnected || !isSpotifyConnectEnabled()) ? 'MainTabs' : 'ConnectSpotify';
      console.log('[Welcome] logged-in user detected, resetting to', dest);
      navigation.reset({
        index: 0,
        routes: [{ name: dest }],
      });
    }
  }, [user, loading, spotifyConnected, navigation]);

  const handlePrivacyPolicyPress = async () => {
    try {
      const supported = await Linking.canOpenURL(PRIVACY_POLICY_URL);
      if (supported) {
        await Linking.openURL(PRIVACY_POLICY_URL);
      } else {
        console.error("Don't know how to open URI: " + PRIVACY_POLICY_URL);
      }
    } catch (error) {
      console.error('Error opening privacy policy:', error);
    }
  };

  // Start Matching goes straight into the guest flow - no interstitial modal.
  const handleStartMatching = async () => {
    if (starting) return;
    setStarting(true);
    trackEvent('start_matching_tapped');

    try {
      // Grant the one-time guest free credit silently
      const granted = await grantGuestFreeCredits();
      console.log('[Guest] credits granted:', granted);

      // Guests must connect Spotify too. Do NOT call refreshSpotifyStatus() here:
      // it sets spotifyChecking=true in AuthContext which unmounts the
      // NavigationContainer and wipes the navigation.reset below.
      const status = await getSpotifyConnectionStatus();
      console.log('[Guest] Spotify status:', JSON.stringify(status));

      // Guests never skip onboarding - onboardingComplete belongs to registered
      // sessions and must not short-circuit the guest path.
      // Already connected -> straight to onboarding. Flag on -> the Spotify
      // prompt (skippable, falls through to the picker). Flag off (the public)
      // -> the in-app taste picker, which is where taste comes from now.
      const target: keyof RootStackParamList = status.connected
        ? 'Onboarding'
        : isSpotifyConnectEnabled()
          ? 'ConnectSpotify'
          : 'TastePicker';
      console.log('[Guest] Navigating to:', target);
      navigation.reset({
        index: 0,
        routes: [{ name: target }],
      });
    } catch (error) {
      console.error('[Guest] Start Matching failed:', error);
      setStarting(false);
    }
  };

  const front = step % 3;
  const topIsCurrent = step % 2 === 0;
  const topOpacity = swap.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const lift = swap.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-6, -10, -6] });
  const cardAt = (offset: number) => MATCH_CARDS[(front + offset) % MATCH_CARDS.length];

  return (
    <View style={styles.container}>
      {/* Background Blur Effects */}
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />

      <SafeAreaView style={styles.safeArea}>
        <Animated.View style={[styles.content, { opacity: enter }]}>
          <Text style={styles.wordmark}>TUNEMATCH</Text>

          {/* Decorative hero: hidden from assistive tech */}
          <View style={styles.hero}>
            <View
              style={styles.stack}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <CardSlot
                current={cardAt(1)}
                next={cardAt(2)}
                topIsCurrent={topIsCurrent}
                topOpacity={topOpacity}
                style={styles.slotBackLeft}
              />
              <CardSlot
                current={cardAt(2)}
                next={cardAt(0)}
                topIsCurrent={topIsCurrent}
                topOpacity={topOpacity}
                style={styles.slotBackRight}
              />
              <CardSlot
                current={cardAt(0)}
                next={cardAt(1)}
                topIsCurrent={topIsCurrent}
                topOpacity={topOpacity}
                style={styles.slotFront}
                lift={lift}
              />
            </View>
          </View>

          <View style={styles.copy}>
            <Text style={styles.headline} maxFontSizeMultiplier={1.3}>
              Match music to your mood.
            </Text>
            <Text style={styles.subtitle}>Pick a photo. We find the songs that fit it, and you.</Text>
          </View>

          <View style={styles.bottom}>
            <OnboardingFooter
              ctaLabel="Start matching"
              onPress={handleStartMatching}
              loading={starting}
              bottomInset={0}
              hairline={false}
            />

            {/* Returning users only: subtle way back in */}
            {hadAccount && (
              <TouchableOpacity
                onPress={() => navigation.navigate('SignIn')}
                activeOpacity={0.7}
                style={styles.signInLink}
                accessibilityRole="button"
              >
                <Text style={styles.signInText}>
                  Already have an account? <Text style={styles.signInTextBold}>Sign in</Text>
                </Text>
              </TouchableOpacity>
            )}

            {/* Legal Disclaimer */}
            <View style={styles.legalSection}>
              <Text style={styles.legalText}>By using TuneMatch, you agree to our </Text>
              <View style={styles.legalLinks}>
                <TouchableOpacity onPress={handlePrivacyPolicyPress} activeOpacity={0.7}>
                  <Text style={styles.legalLink}>Terms of Service</Text>
                </TouchableOpacity>
                <Text style={styles.legalText}> and </Text>
                <TouchableOpacity onPress={handlePrivacyPolicyPress} activeOpacity={0.7}>
                  <Text style={styles.legalLink}>Privacy Policy</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: OB.bg,
  },
  safeArea: {
    flex: 1,
  },
  backgroundBlur1: {
    position: 'absolute',
    top: -height * 0.1,
    left: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: '#f4258c20',
    borderRadius: 9999,
    opacity: 0.3,
  },
  backgroundBlur2: {
    position: 'absolute',
    bottom: -height * 0.1,
    right: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: '#8b5cf620',
    borderRadius: 9999,
    opacity: 0.3,
  },
  content: {
    flex: 1,
  },
  wordmark: {
    paddingTop: Spacing.sm,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    color: OB.textFaint,
  },

  // Hero stack
  hero: {
    flex: 1,
    minHeight: 260,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stack: {
    width: STACK_WIDTH,
    height: STACK_HEIGHT,
  },
  slot: {
    position: 'absolute',
    left: CARD_SPREAD,
    top: 8,
    width: CARD_SIZE,
    height: CARD_SIZE,
  },
  slotBackLeft: {
    opacity: 0.9,
    transform: [{ translateX: -CARD_SPREAD }, { translateY: 16 }, { rotate: '-11deg' }],
  },
  slotBackRight: {
    opacity: 0.9,
    transform: [{ translateX: CARD_SPREAD }, { translateY: 16 }, { rotate: '10deg' }],
  },
  slotFront: {
    zIndex: 2,
    borderRadius: 20,
    backgroundColor: OB.bg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 20,
    overflow: 'hidden',
  },
  tag: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  tagText: {
    color: OB.text,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  pill: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  playDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1DB954',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillCopy: {
    flex: 1,
  },
  song: {
    color: OB.text,
    fontSize: 13,
    fontWeight: '700',
  },
  artist: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
  },

  // Copy
  copy: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: 10,
  },
  headline: {
    color: OB.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  subtitle: {
    color: OB.textDim,
    fontSize: OB.body,
    lineHeight: 21,
    textAlign: 'center',
  },

  // Bottom block
  bottom: {
    paddingBottom: Spacing.sm,
  },
  signInLink: {
    minHeight: OB.hit,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  signInText: {
    color: OB.textDim,
    fontSize: OB.body,
    textAlign: 'center',
  },
  signInTextBold: {
    color: OB.text,
    fontWeight: '700',
  },
  legalSection: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  legalText: {
    color: OB.textFaint,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  legalLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  legalLink: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});

export default WelcomeScreen;
