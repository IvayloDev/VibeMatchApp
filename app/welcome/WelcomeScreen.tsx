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
  Easing,
  StyleProp,
  ViewStyle,
  Image,
  type ImageSourcePropType,
  type ImageStyle,
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
const SWAP_DURATION_MS = 900;

type Gradient = readonly [string, string, string];

interface MatchCardSpec {
  tag: string;
  gradient: Gradient;
  /** The photo behind the song. Files live in assets/welcome/. */
  photo: ImageSourcePropType;
  song: string;
  artist: string;
}

// Index 0 starts in front; the next index sits back-left, the one after
// back-right. Rotation advances the front by one each swap and cycles
// through all five. Photos are the user's own, cropped square at 800px in
// assets/welcome/.
const MATCH_CARDS: MatchCardSpec[] = [
  {
    tag: 'Romantic',
    gradient: ['#ffb36b', '#f4258c', '#4a1d6e'],
    photo: require('../../assets/welcome/oleander.jpg'),
    song: 'Golden Hour',
    artist: 'JVKE',
  },
  {
    tag: 'Chill',
    gradient: ['#1de9b6', '#1c7ed6', '#0b1a3a'],
    photo: require('../../assets/welcome/plane.jpg'),
    song: 'Weightless',
    artist: 'Marconi Union',
  },
  {
    tag: 'Moody',
    gradient: ['#8b5cf6', '#2a1444', '#0f0a1c'],
    photo: require('../../assets/welcome/tram.jpg'),
    song: 'Nightcall',
    artist: 'Kavinsky',
  },
  {
    tag: 'Hype',
    gradient: ['#ff6b35', '#f4258c', '#4a1d6e'],
    photo: require('../../assets/welcome/harbour.jpg'),
    song: 'Digital Love',
    artist: 'Daft Punk',
  },
  {
    tag: 'Chill',
    gradient: ['#c4b5fd', '#1c7ed6', '#0b1a3a'],
    photo: require('../../assets/welcome/prague.jpg'),
    song: 'Holocene',
    artist: 'Bon Iver',
  },
];

// The gradient sits under the photo as its fallback while the image loads,
// and a dark scrim over the lower half keeps the song pill readable on any
// photo.
const MatchCard = ({ card }: { card: MatchCardSpec }) => (
  <LinearGradient colors={card.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
    <Image source={card.photo} style={styles.cardPhoto as ImageStyle} resizeMode="cover" accessible={false} />
    <LinearGradient
      colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.55)']}
      locations={[0, 0.45, 1]}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
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

// Every card is always mounted and moves along one cycle of poses:
// front -> back-right -> behind (invisible) -> behind -> back-left -> front.
// A single clock `t` advances by one per swap; card k sits at phase
// (t + k) mod N and interpolates its position, rotation, scale and opacity
// from that phase. Nothing crossfades and no card ever changes its photo,
// so a swap is pure motion: the front card slides right and away, the
// left card slides up to the front, a fresh card fades in behind on the
// left. With photos on the cards, the old crossfade read as a double
// exposure and the back cards snapped when state flipped.
const N = MATCH_CARDS.length;
const PHASES = [0, 1, 2, 3, 4, 5];
// The two hidden poses sit exactly on top of the visible back poses, so a
// card fades out where it already is and the next one fades in where it will
// stay. Nothing translucent ever travels across the stack, which is what made
// the old swap look like a double exposure.
const POSE_X = [0, CARD_SPREAD, CARD_SPREAD, -CARD_SPREAD, -CARD_SPREAD, 0];
const POSE_Y = [-6, 16, 16, 16, 16, -6];
const POSE_ROT = ['0deg', '10deg', '10deg', '-11deg', '-11deg', '0deg'];
const POSE_SCALE = [1, 0.96, 0.96, 0.96, 0.96, 1];
const POSE_OPACITY = [1, 0.92, 0, 0, 0.92, 1];
// Layer order for the duration of a step, keyed by the phase a card is
// heading to: the card arriving at the front slides over the old front.
// Front on top, then the card arriving from the left, then the right card.
const Z_BY_END_PHASE = [5, 3, 1, 1, 4];

const CarouselCard = ({ card, index, clock, zIndex }: {
  card: MatchCardSpec;
  index: number;
  clock: Animated.Value;
  zIndex: number;
}) => {
  const phase = Animated.modulo(Animated.add(clock, index), N);
  const style: Animated.WithAnimatedObject<ViewStyle> = {
    zIndex,
    opacity: phase.interpolate({ inputRange: PHASES, outputRange: POSE_OPACITY }),
    transform: [
      { translateX: phase.interpolate({ inputRange: PHASES, outputRange: POSE_X }) },
      { translateY: phase.interpolate({ inputRange: PHASES, outputRange: POSE_Y }) },
      { rotate: phase.interpolate({ inputRange: PHASES, outputRange: POSE_ROT }) },
      { scale: phase.interpolate({ inputRange: PHASES, outputRange: POSE_SCALE }) },
    ],
  };
  return (
    <Animated.View style={[styles.slot, style]}>
      <MatchCard card={card} />
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

  // Hero rotation: `clock` advances by exactly one per swap and never
  // resets; `step` mirrors its target so layer order can follow along.
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const clock = useRef(new Animated.Value(0)).current;

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

  // Advance the carousel every few seconds. Skipped entirely when the user
  // has asked for reduced motion, leaving a static stack.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
      stepRef.current += 1;
      // Layer order first, so the incoming card is on top for the whole move.
      setStep(stepRef.current);
      Animated.timing(clock, {
        toValue: stepRef.current,
        duration: SWAP_DURATION_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
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
      clock.stopAnimation();
    };
  }, [clock]);

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

  // Where each card will be once the current move finishes, for layering.
  const zFor = (index: number) => Z_BY_END_PHASE[(step + index) % N];

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
              {MATCH_CARDS.map((card, index) => (
                <CarouselCard key={card.tag + card.song} card={card} index={index} clock={clock} zIndex={zFor(index)} />
              ))}
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
              pulse
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
    borderRadius: 20,
    backgroundColor: OB.bg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 10,
  },
  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 20,
    overflow: 'hidden',
  },
  cardPhoto: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: CARD_SIZE,
    height: CARD_SIZE,
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
