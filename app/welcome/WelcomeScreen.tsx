import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Linking,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as SecureStore from 'expo-secure-store';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradientFallback as LinearGradient } from '../../lib/components/LinearGradientFallback';
import { grantGuestFreeCredits } from '../../lib/utils/freeCredits';
import { useAuth } from '../../lib/AuthContext';
import { HAD_ACCOUNT_KEY } from '../../lib/AuthContext';
import { getSpotifyConnectionStatus } from '../../lib/spotify';
import { trackEvent } from '../../lib/posthog';
import { Colors, Spacing, Layout, BorderRadius } from '../../lib/designSystem';

// Define the navigation stack param list
type RootStackParamList = {
  Welcome: undefined;
  SignUp: undefined;
  SignIn: undefined;
  ConnectSpotify: undefined;
  Onboarding: undefined;
  MainTabs: undefined;
};

const PRIVACY_POLICY_URL = 'https://ivaylodev.github.io/vibematch-privacy-policy/';

const { width, height } = Dimensions.get('window');

// Brand colors used across the app (see DashboardScreen / AnalyzingScreen)
const DesignColors = {
  primary: '#f4258c',
  accentPurple: '#8b5cf6',
  accentBlue: Colors.accent.blue,
  backgroundDark: '#221019',
};

// Album-cover carousel config. The cards are stylized (no real artist photos) -
// each is a rich gradient "cover" with an abstract artist/music motif, so the
// screen reads as a wall of album art scrolling by.
const CARD_SIZE = 118;
const CARD_GAP = Spacing.sm + 4;
const CARD_STEP = CARD_SIZE + CARD_GAP;

type MotifIcon = keyof typeof MaterialCommunityIcons.glyphMap;

interface CardSpec {
  icon: MotifIcon;
  gradient: string[];
}

// Duotone gradients spanning the brand palette for cover variety
const GRADIENTS: string[][] = [
  [DesignColors.primary, DesignColors.accentPurple],
  [DesignColors.accentPurple, DesignColors.accentBlue],
  ['#FF6B6B', DesignColors.primary],
  [DesignColors.accentBlue, DesignColors.accentPurple],
  ['#7C4DFF', '#18A0FB'],
  [DesignColors.primary, '#FF9F45'],
  ['#0FB8AD', DesignColors.accentBlue],
  [DesignColors.accentPurple, DesignColors.primary],
];

// Motifs alternate artist silhouettes and instruments so the covers feel varied
const CARD_MOTIFS: MotifIcon[] = [
  'account-music',
  'microphone-variant',
  'guitar-electric',
  'headphones',
  'album',
  'piano',
  'account-tie',
  'saxophone',
  'guitar-acoustic',
  'music-clef-treble',
];

const buildCards = (icons: MotifIcon[]): CardSpec[] =>
  icons.map((icon, index) => ({
    icon,
    gradient: GRADIENTS[index % GRADIENTS.length],
  }));

const ROW_ONE_CARDS = buildCards(CARD_MOTIFS);
// Shifted order + different gradient offset so the two rows don't mirror
const ROW_TWO_CARDS = buildCards([...CARD_MOTIFS.slice(5), ...CARD_MOTIFS.slice(0, 5)]);

// Width of a single card set - each row renders the set twice and animates
// by exactly one set width for a seamless loop
const ROW_SET_WIDTH = CARD_MOTIFS.length * CARD_STEP;
const MARQUEE_DURATION = 28000;

const AlbumCard = ({ card }: { card: CardSpec }) => (
  <View style={styles.cardWrapper}>
    <LinearGradient
      colors={card.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      {/* Vinyl-disc accent for an album-art feel */}
      <View style={styles.cardDisc} />
      <View style={styles.cardDiscHole} />
      <MaterialCommunityIcons name={card.icon} size={44} color="rgba(255,255,255,0.95)" />
      {/* Bottom sheen bar, like a cover title strip */}
      <View style={styles.cardStrip} />
    </LinearGradient>
  </View>
);

const WelcomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, loading, spotifyConnected } = useAuth();
  const [starting, setStarting] = useState(false);
  // Only returning (previously signed-in) users see a sign-in affordance;
  // brand-new users get a pure Start Matching screen.
  const [hadAccount, setHadAccount] = useState(false);

  // Marquee progress values (0 -> 1 mapped to one card-set width)
  const rowOneAnim = useRef(new Animated.Value(0)).current;
  const rowTwoAnim = useRef(new Animated.Value(0)).current;

  // Title / tagline / button entrance
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(24)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslate = useRef(new Animated.Value(16)).current;
  const buttonsOpacity = useRef(new Animated.Value(0)).current;

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

  // Looped marquee animations - both rows scroll continuously in
  // opposite directions, resetting after exactly one card-set width
  useEffect(() => {
    const rowOneLoop = Animated.loop(
      Animated.timing(rowOneAnim, {
        toValue: 1,
        duration: MARQUEE_DURATION,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const rowTwoLoop = Animated.loop(
      Animated.timing(rowTwoAnim, {
        toValue: 1,
        duration: MARQUEE_DURATION,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    rowOneLoop.start();
    rowTwoLoop.start();

    return () => {
      rowOneLoop.stop();
      rowTwoLoop.stop();
    };
  }, [rowOneAnim, rowTwoAnim]);

  // Staggered entrance for title, tagline, and button
  useEffect(() => {
    Animated.stagger(200, [
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslate, {
          toValue: 0,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(taglineOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(taglineTranslate, {
          toValue: 0,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(buttonsOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [titleOpacity, titleTranslate, taglineOpacity, taglineTranslate, buttonsOpacity]);

  // Redirect if user is already logged in: Spotify gate first, then MainTabs
  useEffect(() => {
    console.log('[Welcome] auth effect - loading:', loading, 'user:', !!user, 'spotifyConnected:', spotifyConnected);
    if (!loading && user) {
      const dest = spotifyConnected ? 'MainTabs' : 'ConnectSpotify';
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
      const target: keyof RootStackParamList = status.connected ? 'Onboarding' : 'ConnectSpotify';
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

  const rowOneTranslate = rowOneAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -ROW_SET_WIDTH],
  });
  const rowTwoTranslate = rowTwoAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-ROW_SET_WIDTH, 0],
  });

  return (
    <View style={styles.container}>
      {/* Background Blur Effects */}
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          {/* Album-cover carousel */}
          <View style={styles.marqueeSection}>
            <View style={styles.marqueeRow}>
              <Animated.View
                style={[styles.marqueeTrack, { transform: [{ translateX: rowOneTranslate }] }]}
              >
                {[...ROW_ONE_CARDS, ...ROW_ONE_CARDS].map((card, index) => (
                  <AlbumCard key={`row1-${index}`} card={card} />
                ))}
              </Animated.View>
            </View>
            <View style={styles.marqueeRow}>
              <Animated.View
                style={[styles.marqueeTrack, { transform: [{ translateX: rowTwoTranslate }] }]}
              >
                {[...ROW_TWO_CARDS, ...ROW_TWO_CARDS].map((card, index) => (
                  <AlbumCard key={`row2-${index}`} card={card} />
                ))}
              </Animated.View>
            </View>
          </View>

          {/* Title + Tagline */}
          <View style={styles.titleSection}>
            <Animated.Text
              style={[
                styles.mainTitle,
                { opacity: titleOpacity, transform: [{ translateY: titleTranslate }] },
              ]}
            >
              TuneMatch
            </Animated.Text>
            <Animated.Text
              style={[
                styles.tagline,
                { opacity: taglineOpacity, transform: [{ translateY: taglineTranslate }] },
              ]}
            >
              Match music to your mood.
            </Animated.Text>
          </View>

          {/* Primary action - Start Matching only */}
          <Animated.View style={[styles.bottomSection, { opacity: buttonsOpacity }]}>
            <TouchableOpacity
              onPress={handleStartMatching}
              activeOpacity={0.9}
              disabled={starting}
              style={styles.primaryButtonWrapper}
            >
              <LinearGradient
                colors={[DesignColors.primary, DesignColors.accentPurple]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Start Matching</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Returning users only: subtle way back in */}
            {hadAccount && (
              <TouchableOpacity
                onPress={() => navigation.navigate('SignIn')}
                activeOpacity={0.7}
                style={styles.signInLink}
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
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DesignColors.backgroundDark,
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
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  marqueeSection: {
    flex: 1,
    justifyContent: 'center',
    gap: CARD_GAP,
  },
  marqueeRow: {
    width: '100%',
    height: CARD_SIZE,
    overflow: 'hidden',
  },
  marqueeTrack: {
    flexDirection: 'row',
    width: ROW_SET_WIDTH * 2,
  },
  cardWrapper: {
    marginRight: CARD_GAP,
  },
  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: BorderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  cardDisc: {
    position: 'absolute',
    width: CARD_SIZE * 0.62,
    height: CARD_SIZE * 0.62,
    borderRadius: CARD_SIZE,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  cardDiscHole: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  cardStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: CARD_SIZE * 0.22,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  titleSection: {
    alignItems: 'center',
    paddingHorizontal: Layout.screenPadding,
    marginTop: Spacing.xl,
    marginBottom: Spacing.xxl,
  },
  mainTitle: {
    fontSize: 46,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -1,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 17,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  bottomSection: {
    alignItems: 'center',
    paddingHorizontal: Layout.screenPadding,
    paddingBottom: Spacing.lg,
  },
  primaryButtonWrapper: {
    width: '100%',
    borderRadius: BorderRadius.xl,
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  primaryButton: {
    width: '100%',
    borderRadius: BorderRadius.xl,
    paddingVertical: Spacing.md + 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  signInLink: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  signInText: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  signInTextBold: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  legalSection: {
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.xl,
  },
  legalText: {
    fontSize: 11,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 16,
  },
  legalLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  legalLink: {
    fontSize: 11,
    fontWeight: '500',
    color: DesignColors.primary,
    textDecorationLine: 'underline',
  },
});

export default WelcomeScreen;
