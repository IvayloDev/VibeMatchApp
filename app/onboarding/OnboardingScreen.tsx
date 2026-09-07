import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Alert,
  BackHandler,
  ScrollView,
} from 'react-native';
import type { ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../lib/supabase';
import { loadGuestTasteProfile, getSpotifyConnectionStatus } from '../../lib/spotify';
import { useAuth } from '../../lib/AuthContext';
import { triggerHaptic } from '../../lib/utils/haptics';
import { trackEvent, registerSuperProperties } from '../../lib/posthog';
import { Spacing } from '../../lib/designSystem';
import { VibeGrid } from '../../lib/components/VibeGrid';
import { OB, OnboardingHeader, OnboardingIntro, OnboardingFooter, TasteChip } from '../../lib/components/OnboardingChrome';
import { getTasteSource, erasFromTopGenres, ERA_TAG_PREFIX } from '../../lib/taste';
import type { TasteSource } from '../../lib/taste';
import { getVibeById } from '../../lib/vibes';

/**
 * First-run step 2 of 2: pick a photo, pick a vibe, get the first match.
 *
 * This used to be a six-to-eight page flow: a welcome page, "Wrapped" style
 * reveals of the genre, artist and personality the user had typed in twenty
 * seconds earlier, a fake progress bar, then photo, then vibe. Day-1
 * retention sat at 3% and the first match came about 70 seconds after
 * install. The reveals restated the user's own input and the progress bar
 * delayed them, so both are gone. Taste is acknowledged with one chip on
 * this screen, and the first match is the reveal.
 *
 * Layout is sized so that on a 6.1 inch phone the photo, the four vibes and
 * the button are all visible without scrolling: the photo is a 4:3 cover and
 * the vibes are compact rows, because the photo is the hero here.
 */

type TasteProfile = {
  top_artists?: { name: string; genres?: string[]; image?: string | null }[];
  top_tracks?: { name: string; artist?: string; image?: string | null }[];
  top_genres?: string[];
  recently_played?: { name: string; artist?: string; image?: string | null }[];
  // 'manual' = picked in-app (TastePickerScreen). Absent or 'spotify' = synced
  // from Spotify listening data.
  source?: 'manual' | 'spotify';
};

type RootStackParamList = {
  TastePicker: { returnTo?: 'back' } | undefined;
  Onboarding: undefined;
  MainTabs: undefined;
  OnboardingAnalyzing: { image: string; selectedVibe?: string; userId?: string; fromOnboarding?: boolean };
};

const PAGE_KEY = 'photo_vibe';
const TOTAL_STEPS = 4;
const THIS_STEP = 4;

// "hip hop" -> "Hip Hop"
const titleCase = (s: string) =>
  s.replace(/(^|[\s&-])([a-z])/g, (_m, lead: string, letter: string) => lead + letter.toUpperCase());

// "1980s" -> "80s". The 2000s and later keep their full name: "00s" and "10s"
// do not read as decades.
const shortEra = (era: string) => (/^19\d0s$/.test(era) ? era.slice(2) : era);

/** "Rock · 80s · 90s" from the picked or synced profile. */
function tasteSummary(profile: TasteProfile | null): string | null {
  if (!profile) return null;
  const genres = (profile.top_genres ?? [])
    .filter((g) => typeof g === 'string' && !g.startsWith(ERA_TAG_PREFIX))
    .slice(0, 2)
    .map(titleCase);
  const eras = erasFromTopGenres(profile.top_genres).slice(0, 2).map(shortEra);
  const artists = (profile.top_artists ?? []).slice(0, 2).map((a) => a.name).filter(Boolean);
  const parts = [...artists, ...genres, ...eras];
  if (parts.length === 0) return null;
  const shown = parts.slice(0, 3);
  const more = parts.length - shown.length;
  return `${shown.join(' · ')}${more > 0 ? ` +${more}` : ''}`;
}

const OnboardingScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { markOnboardingComplete, markGuestOnboardingComplete } = useAuth();

  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [selectedVibe, setSelectedVibe] = useState<string | null>(null);
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  // Set once the user launches a scan; onboarding is finished from then on.
  const completedRef = useRef(false);
  const startedAtRef = useRef(0);
  const startedRef = useRef(false);

  const photoReveal = useRef(new Animated.Value(0)).current;
  const vibeReveal = useRef(new Animated.Value(0)).current;
  const titleFade = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<ScrollView>(null);

  // Load the taste profile once, for the analytics cohort and the taste chip.
  useEffect(() => {
    const fetchProfile = async (): Promise<TasteProfile | null> => {
      // A Spotify-derived taste profile outlives the connection that produced
      // it, so for Spotify data the live connection is the source of truth. A
      // profile picked in-app (source 'manual') was typed on this device, or
      // into this account, by the person it describes, so it is used as is.
      let connected = false;
      try {
        const status = await getSpotifyConnectionStatus();
        connected = status.connected;
      } catch {
        connected = false;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data } = await supabase
          .from('spotify_taste_profiles')
          .select('top_genres, top_artists, top_tracks')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (!data) return null;
        // The table has no source column; a row for a user who is not
        // connected can only have come from the picker.
        return { ...data, source: connected ? 'spotify' : 'manual' };
      }

      const guestProfile = (await loadGuestTasteProfile()) as TasteProfile | null;
      if (!guestProfile) return null;
      if (guestProfile.source === 'manual') return guestProfile;
      if (!connected) return null;
      return { ...guestProfile, source: 'spotify' };
    };

    fetchProfile()
      .then((data) => { if (data) setProfile(data); })
      .catch(() => {})
      .finally(() => setProfileLoaded(true));
  }, []);

  const hasTaste =
    (profile?.top_genres?.length ?? 0) > 0 || (profile?.top_artists?.length ?? 0) > 0;
  const variant = hasTaste ? 'taste' : 'no_taste';
  const tasteSource: TasteSource = getTasteSource(profile);
  const summary = useMemo(() => tasteSummary(profile), [profile]);

  useEffect(() => {
    if (!profileLoaded || startedRef.current) return;
    startedRef.current = true;
    startedAtRef.current = Date.now();
    registerSuperProperties({ has_taste: hasTaste, taste_source: tasteSource, onboarding_variant: variant });
    trackEvent('onboarding_started', {
      variant,
      has_taste: hasTaste,
      taste_source: tasteSource,
      total_pages: 1,
    });
    trackEvent('onboarding_page_viewed', {
      variant,
      has_taste: hasTaste,
      page_key: PAGE_KEY,
      page_index: 0,
      total_pages: 1,
    });
  }, [profileLoaded, variant, hasTaste, tasteSource]);

  // Coming back from OnboardingAnalyzing (blocked scan, or a plain back press)
  // used to leave goLiveLoading stuck at true, so the CTA stayed disabled.
  useFocusEffect(
    useCallback(() => {
      setGoLiveLoading(false);
    }, [])
  );

  const goToTaste = useCallback(() => {
    triggerHaptic('light');
    navigation.reset({ index: 0, routes: [{ name: 'TastePicker' }] });
  }, [navigation]);

  // Onboarding is the root of its stack. Back returns to the taste step; once
  // a scan has launched, onboarding is complete and back belongs in the app.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (completedRef.current) {
          navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
          return true;
        }
        goToTaste();
        return true;
      });
      return () => sub.remove();
    }, [navigation, goToTaste])
  );

  const pickPhoto = async () => {
    triggerHaptic('medium');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photos access needed', 'Allow access to your photo library to pick a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const { uri } = await ImageManipulator.manipulateAsync(
      result.assets[0].uri,
      [{ resize: { width: 800 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );

    const firstPhoto = !photoUri;
    setPhotoUri(uri);
    if (!firstPhoto) return;

    // The photo lands, the vibes follow a beat later, and the title asks the
    // next question. Each animation marks a state change, nothing else moves.
    photoReveal.setValue(0);
    vibeReveal.setValue(0);
    titleFade.setValue(0);
    Animated.parallel([
      Animated.timing(titleFade, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(photoReveal, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(80),
        Animated.spring(vibeReveal, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }),
      ]),
    ]).start();
    // On a small phone the vibes may sit under the fold; bring them into view.
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 350);
  };

  const handleGoLive = async () => {
    if (!photoUri || !selectedVibe || goLiveLoading) return;
    setGoLiveLoading(true);
    triggerHaptic('success');
    try {
      trackEvent('onboarding_completed', {
        variant,
        has_taste: hasTaste,
        taste_source: tasteSource,
        total_pages: 1,
        vibe: selectedVibe,
        duration_ms: startedAtRef.current ? Date.now() - startedAtRef.current : null,
      });

      // Mark onboarding complete before launching analysis.
      await markOnboardingComplete();
      completedRef.current = true;

      const { data: { session } } = await supabase.auth.getSession();

      // Guests are routed by a device-scoped flag, since they have no Supabase
      // user for `onboardingComplete` to hang off. Without this a guest lands
      // back on Welcome every cold start and repeats onboarding forever.
      if (!session?.user) {
        await markGuestOnboardingComplete();
      }
      navigation.navigate('OnboardingAnalyzing', {
        image: photoUri,
        selectedVibe,
        userId: session?.user?.id,
        fromOnboarding: true,
      });
    } catch {
      setGoLiveLoading(false);
      Alert.alert('Something went wrong', 'Please try again.');
    }
  };

  const canMatch = !!photoUri && !!selectedVibe;
  const vibeName = getVibeById(selectedVibe)?.name;
  const footerSummary = !photoUri
    ? 'Pick a photo to start'
    : !selectedVibe
      ? 'Now pick how it should feel'
      : summary
        ? `${vibeName} · tuned to ${summary}`
        : `${vibeName} · ready when you are`;

  const revealStyle = (value: Animated.Value): Animated.WithAnimatedObject<ViewStyle> => ({
    opacity: value,
    transform: [
      { scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
    ],
  });

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <OnboardingHeader step={THIS_STEP} total={TOTAL_STEPS} onBack={goToTaste} />

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: titleFade }}>
            <OnboardingIntro
              eyebrow={`Step ${THIS_STEP} of ${TOTAL_STEPS}`}
              title={photoUri ? 'How should it feel?' : 'Pick a photo'}
              subtitle={photoUri ? undefined : 'Any photo works: a place, a face, a night out.'}
            />
          </Animated.View>

          {profileLoaded ? (
            <View style={styles.tasteRow}>
              <TasteChip summary={summary ? `Tuned to ${summary}` : null} onPress={goToTaste} />
            </View>
          ) : null}

          {photoUri ? (
            <Animated.View style={[styles.photoWrap, revealStyle(photoReveal)]}>
              <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" accessibilityLabel="Your chosen photo" />
              <TouchableOpacity
                style={styles.changeBtn}
                onPress={pickPhoto}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Change photo"
              >
                <Text style={styles.changeBtnText}>Change</Text>
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <View style={styles.dropzoneWrap}>
            <TouchableOpacity
              style={styles.dropzone}
              onPress={pickPhoto}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Choose a photo from your library"
            >
              <View style={styles.dropzoneIcon}>
                <MaterialCommunityIcons name="image-plus" size={26} color={OB.primary} />
              </View>
              <Text style={styles.dropzoneTitle}>Choose from your library</Text>
              <Text style={styles.dropzoneHint}>Portrait or landscape, any light.</Text>
            </TouchableOpacity>
            </View>
          )}

          {!photoUri ? (
            <Text style={styles.privacyText}>Photos stay on your phone until you match.</Text>
          ) : (
            <Animated.View style={[styles.vibeWrap, revealStyle(vibeReveal)]}>
              <VibeGrid
                variant="compact"
                selected={selectedVibe}
                onSelect={(id) => { triggerHaptic('light'); setSelectedVibe(id); }}
              />
            </Animated.View>
          )}
        </ScrollView>

        <OnboardingFooter
          ctaLabel="Match my song"
          onPress={handleGoLive}
          disabled={!canMatch}
          loading={goLiveLoading}
          summary={footerSummary}
          bottomInset={insets.bottom}
        />
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: OB.bg },
  flex: { flex: 1 },
  scroll: { paddingBottom: Spacing.md },
  tasteRow: { paddingHorizontal: OB.margin, marginTop: Spacing.md },
  // A plain full-width row owns the margins. aspectRatio on a self-margined
  // child let Yoga settle on a narrower box than the stretch width, which put
  // the dropzone 20pt from the left but 41pt from the right.
  dropzoneWrap: { marginTop: Spacing.md, paddingHorizontal: OB.margin },
  dropzone: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: Spacing.lg,
  },
  dropzoneIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(244,37,140,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  dropzoneTitle: { color: OB.text, fontSize: 16, fontWeight: '700' },
  dropzoneHint: { color: 'rgba(255,255,255,0.5)', fontSize: OB.caption },
  privacyText: {
    color: OB.textFaint,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: Spacing.md,
    marginHorizontal: OB.margin,
  },
  photoWrap: {
    marginTop: Spacing.md,
    marginHorizontal: OB.margin,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: OB.surface,
  },
  photo: { width: '100%', aspectRatio: 4 / 3 },
  changeBtn: {
    position: 'absolute',
    right: 10,
    top: 10,
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeBtnText: { color: OB.text, fontSize: OB.caption, fontWeight: '700' },
  vibeWrap: { marginTop: 14, paddingHorizontal: OB.margin },
});

export default OnboardingScreen;
