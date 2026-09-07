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
import { OB, OnboardingHeader, OnboardingIntro, OnboardingFooter } from '../../lib/components/OnboardingChrome';
import { getTasteSource, erasFromTopGenres, ERA_TAG_PREFIX } from '../../lib/taste';
import type { TasteSource } from '../../lib/taste';

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
const TOTAL_STEPS = 2;
const THIS_STEP = 2;

// "hip hop" -> "Hip Hop"
const titleCase = (s: string) =>
  s.replace(/(^|[\s&-])([a-z])/g, (_m, lead: string, letter: string) => lead + letter.toUpperCase());

/** "Tuned to Rock, 1980s and 1990s" from the picked or synced profile. */
function tasteSummary(profile: TasteProfile | null): string | null {
  if (!profile) return null;
  const genres = (profile.top_genres ?? [])
    .filter((g) => typeof g === 'string' && !g.startsWith(ERA_TAG_PREFIX))
    .slice(0, 2)
    .map(titleCase);
  const eras = erasFromTopGenres(profile.top_genres).slice(0, 2);
  const artists = (profile.top_artists ?? []).slice(0, 2).map((a) => a.name).filter(Boolean);
  const parts = [...artists, ...genres, ...eras];
  if (parts.length === 0) return null;
  const shown = parts.slice(0, 3);
  const more = parts.length - shown.length;
  return `Tuned to ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
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

    setPhotoUri(uri);
    photoReveal.setValue(0);
    Animated.spring(photoReveal, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }).start();
    // The vibe grid appears under the photo; bring it into view.
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
  const footerSummary = !photoUri
    ? 'Pick a photo to start'
    : !selectedVibe
      ? 'Now pick how it should feel'
      : summary ?? 'Ready when you are';

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
          <OnboardingIntro
            title={photoUri ? 'How should it feel?' : 'Pick a photo'}
            subtitle={
              photoUri
                ? 'Same photo, four moods. Choose the one you are going for.'
                : 'A selfie, a sunset, your dog. The photo sets the mood, your taste sets the sound.'
            }
          />

          {summary && profileLoaded ? (
            <TouchableOpacity
              style={styles.tasteChip}
              onPress={goToTaste}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${summary}. Edit taste.`}
            >
              <MaterialCommunityIcons name="music-note" size={14} color={OB.primary} />
              <Text style={styles.tasteChipText} numberOfLines={1}>{summary}</Text>
              <Text style={styles.tasteChipEdit}>Edit</Text>
            </TouchableOpacity>
          ) : null}

          {photoUri ? (
            <Animated.View
              style={[
                styles.photoWrap,
                {
                  opacity: photoReveal,
                  transform: [{ scale: photoReveal.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
                },
              ]}
            >
              <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" accessibilityLabel="Your chosen photo" />
              <TouchableOpacity
                style={styles.changeBtn}
                onPress={pickPhoto}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Change photo"
              >
                <MaterialCommunityIcons name="image-edit-outline" size={16} color={OB.text} />
                <Text style={styles.changeBtnText}>Change</Text>
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <TouchableOpacity
              style={styles.dropzone}
              onPress={pickPhoto}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Choose a photo from your library"
            >
              <View style={styles.dropzoneIcon}>
                <MaterialCommunityIcons name="image-plus" size={30} color={OB.text} />
              </View>
              <Text style={styles.dropzoneTitle}>Choose from your photos</Text>
              <Text style={styles.dropzoneHint}>Any photo works. Portrait or landscape.</Text>
            </TouchableOpacity>
          )}

          {!photoUri ? (
            <View style={styles.privacyRow}>
              <MaterialCommunityIcons name="lock-outline" size={14} color={OB.textFaint} />
              <Text style={styles.privacyText}>
                Only the photo you pick is analyzed. The rest of your library is never touched.
              </Text>
            </View>
          ) : (
            <View style={styles.vibeWrap}>
              <VibeGrid
                selected={selectedVibe}
                onSelect={(id) => { triggerHaptic('light'); setSelectedVibe(id); }}
              />
            </View>
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
  scroll: { paddingBottom: Spacing.xl },
  tasteChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.md,
    marginHorizontal: Spacing.lg,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: OB.surface,
    borderWidth: 1,
    borderColor: OB.border,
    maxWidth: '90%',
  },
  tasteChipText: { color: OB.textDim, fontSize: OB.caption, flexShrink: 1 },
  tasteChipEdit: { color: OB.primary, fontSize: OB.caption, fontWeight: '700', marginLeft: 4 },
  dropzone: {
    marginTop: Spacing.lg,
    marginHorizontal: Spacing.lg,
    minHeight: 260,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: OB.border,
    backgroundColor: OB.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: Spacing.lg,
  },
  dropzoneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: OB.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  dropzoneTitle: { color: OB.text, fontSize: 17, fontWeight: '700' },
  dropzoneHint: { color: OB.textDim, fontSize: OB.caption },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: Spacing.md,
    marginHorizontal: Spacing.lg,
  },
  privacyText: { color: OB.textFaint, fontSize: OB.caption, lineHeight: 18, flex: 1 },
  photoWrap: {
    marginTop: Spacing.lg,
    marginHorizontal: Spacing.lg,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: OB.surface,
  },
  photo: { width: '100%', aspectRatio: 4 / 3 },
  changeBtn: {
    position: 'absolute',
    right: 10,
    top: 10,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  changeBtnText: { color: OB.text, fontSize: OB.caption, fontWeight: '600' },
  vibeWrap: { marginTop: Spacing.lg, paddingHorizontal: Spacing.md },
});

export default OnboardingScreen;
