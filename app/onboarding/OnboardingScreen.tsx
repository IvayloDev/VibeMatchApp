import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradientFallback as LinearGradient } from '../../lib/components/LinearGradientFallback';
import { supabase } from '../../lib/supabase';
import { loadGuestTasteProfile, syncTasteProfile } from '../../lib/spotify';
import { useAuth } from '../../lib/AuthContext';
import { triggerHaptic } from '../../lib/utils/haptics';
import { Spacing, BorderRadius } from '../../lib/designSystem';
import { VIBES } from '../../lib/vibes';
import { VibeGrid } from '../../lib/components/VibeGrid';

const { width, height } = Dimensions.get('window');

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#0D0010',
  primary: '#f4258c',
  purple: '#8b5cf6',
  white: '#FFFFFF',
  dim: 'rgba(255,255,255,0.55)',
  dimMore: 'rgba(255,255,255,0.25)',
  card: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.12)',
};

// ─── Personality map ──────────────────────────────────────────────────────────
type Personality = { name: string; tagline: string; emoji: string; color: string };

function derivePersonality(genres: string[]): Personality {
  const g = genres.join(' ').toLowerCase();

  if (/electronic|edm|techno|house|trance|synth/.test(g))
    return { name: 'The Digital Nomad', tagline: 'You surf sonic waves and live in electric moments. Every beat is a portal.', emoji: '⚡', color: '#00D4FF' };
  if (/hip.?hop|rap|trap|drill/.test(g))
    return { name: 'The Storyteller', tagline: 'Rhythm is your language. You feel every word and let the flow guide your soul.', emoji: '🎤', color: '#FF6B35' };
  if (/metal|punk|hardcore/.test(g))
    return { name: 'The Rebel Soul', tagline: 'You charge through life with the volume all the way up. Rules are made to be broken.', emoji: '🔥', color: '#FF3B30' };
  if (/rock|grunge|alternative/.test(g))
    return { name: 'The Free Thinker', tagline: 'Raw energy and authentic sound define you. You march to your own beat.', emoji: '🎸', color: '#FF8C42' };
  if (/jazz|blues|soul|funk/.test(g))
    return { name: 'The Free Spirit', tagline: 'You improvise through life with effortless cool. Every moment is a jam session.', emoji: '🎺', color: '#FFD93D' };
  if (/classical|orchestra|opera|chamber/.test(g))
    return { name: 'The Architect', tagline: 'You hear structure in everything. Music is your blueprint for perfection.', emoji: '🎻', color: '#A8D8EA' };
  if (/indie|folk|singer.?songwriter/.test(g))
    return { name: 'The Visionary', tagline: "You discover tomorrow's anthems today. Authenticity is your north star.", emoji: '🌙', color: '#8B5CF6' };
  if (/r&b|rnb|neo.?soul|gospel/.test(g))
    return { name: 'The Empath', tagline: 'Music moves through you like emotion. You feel every frequency deep in your core.', emoji: '💜', color: '#FF69B4' };
  if (/country|bluegrass|americana/.test(g))
    return { name: 'The Heartkeeper', tagline: 'Stories live in your songs. You carry every lyric like a memory worth keeping.', emoji: '🌾', color: '#F4A261' };
  if (/pop|k.?pop|dance/.test(g))
    return { name: 'The Trendsetter', tagline: "You're always one step ahead of the moment. Your soundtrack goes platinum.", emoji: '✨', color: '#f4258c' };
  if (/latin|reggaeton|salsa|bossa/.test(g))
    return { name: 'The Fire Dancer', tagline: 'You bring heat to every room. Music is your native language — and you speak it fluently.', emoji: '💃', color: '#FF4500' };

  return { name: 'The Eclectic', tagline: 'Your taste knows no limits. You move through genres like a musical nomad, collecting vibes.', emoji: '🎭', color: '#8B5CF6' };
}

// ─── Types ────────────────────────────────────────────────────────────────────
type TasteProfile = {
  top_artists?: { name: string; genres?: string[]; image?: string | null }[];
  top_tracks?: { name: string; artist?: string; image?: string | null }[];
  top_genres?: string[];
  recently_played?: { name: string; artist?: string; image?: string | null }[];
};

type RootStackParamList = {
  Onboarding: undefined;
  MainTabs: undefined;
  OnboardingAnalyzing: { image: string; selectedVibe?: string; userId?: string; fromOnboarding?: boolean };
};

const TOTAL_PAGES = 8;

// ─── Page components ──────────────────────────────────────────────────────────

const WelcomePage: React.FC<{ user: any; onNext: () => void }> = ({ user, onNext }) => {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  const name = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Music Lover';

  return (
    <Animated.View style={[styles.page, { opacity, transform: [{ scale }] }]}>
      <View style={styles.welcomeIconWrap}>
        <LinearGradient colors={[C.primary + '40', C.purple + '40']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.welcomeIconGradient}>
          <MaterialCommunityIcons name="music-circle" size={72} color={C.primary} />
        </LinearGradient>
      </View>

      <Text style={styles.welcomeLabel}>WELCOME</Text>
      <Text style={styles.welcomeName}>{name}</Text>
      <Text style={styles.welcomeSubtitle}>
        We scanned your Spotify listening history.{'\n'}Your sound DNA is ready.
      </Text>

      <View style={styles.statRow}>
        <View style={styles.statChip}>
          <MaterialCommunityIcons name="headphones" size={16} color={C.primary} />
          <Text style={styles.statChipText}>Taste Profile Loaded</Text>
        </View>
        <View style={styles.statChip}>
          <MaterialCommunityIcons name="check-circle" size={16} color='#30D158' />
          <Text style={styles.statChipText}>Ready</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.nextBtn} onPress={() => { triggerHaptic('medium'); onNext(); }} activeOpacity={0.85}>
        <Text style={styles.nextBtnText}>Reveal My DNA</Text>
        <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" />
      </TouchableOpacity>
    </Animated.View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const GenrePage: React.FC<{ genres: string[]; onNext: () => void }> = ({ genres, onNext }) => {
  const bigScale = useRef(new Animated.Value(0.4)).current;
  const bigOpacity = useRef(new Animated.Value(0)).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(150),
      Animated.parallel([
        Animated.spring(bigScale, { toValue: 1, tension: 55, friction: 7, useNativeDriver: true }),
        Animated.timing(bigOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
      Animated.timing(labelOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const formatGenre = (g: string) =>
    g.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const displayGenre = genres[0] ? formatGenre(genres[0]) : 'Mixed';
  const runnerUps = genres.slice(1, 3);

  return (
    <View style={styles.page}>
      <Text style={styles.statLabel}>YOUR #1 GENRE</Text>

      <View style={styles.bigRevealWrap}>
        <Animated.View style={{ opacity: bigOpacity, transform: [{ scale: bigScale }] }}>
          <LinearGradient colors={[C.primary + '25', C.purple + '25']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.bigGenreCircle}>
            <MaterialCommunityIcons name="music-note" size={52} color={C.primary} />
          </LinearGradient>
        </Animated.View>

        <Animated.Text style={[styles.bigGenreText, { opacity: bigOpacity, transform: [{ scale: bigScale }] }]}>
          {displayGenre}
        </Animated.Text>

        <Animated.Text style={[styles.genreCaption, { opacity: labelOpacity }]}>
          This genre showed up more than any other{'\n'}in your listening history
        </Animated.Text>

        {runnerUps.length > 0 && (
          <Animated.View style={[styles.genreRunnerUpRow, { opacity: labelOpacity }]}>
            {runnerUps.map((g, i) => (
              <View key={g} style={styles.genreRunnerUpChip}>
                <Text style={styles.genreRunnerUpRank}>#{i + 2}</Text>
                <Text style={styles.genreRunnerUpText} numberOfLines={1}>{formatGenre(g)}</Text>
              </View>
            ))}
          </Animated.View>
        )}
      </View>

      <TouchableOpacity style={styles.nextBtn} onPress={() => { triggerHaptic('medium'); onNext(); }} activeOpacity={0.85}>
        <Text style={styles.nextBtnText}>Keep Going</Text>
        <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const ArtistPage: React.FC<{ artist: string; image?: string | null; onNext: () => void }> = ({ artist, image, onNext }) => {
  const slideY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(100),
      Animated.parallel([
        Animated.spring(slideY, { toValue: 0, tension: 60, friction: 9, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.page}>
      <Text style={styles.statLabel}>YOUR MOST PLAYED</Text>

      <View style={styles.bigRevealWrap}>
        <Animated.View style={[styles.artistAvatarWrap, { opacity, transform: [{ translateY: slideY }] }]}>
          <Animated.View style={[styles.artistGlow, {
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.55] }),
          }]} />
          {image ? (
            <Image source={{ uri: image }} style={styles.artistAvatarImage} resizeMode="cover" />
          ) : (
            <LinearGradient colors={[C.primary, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.artistAvatar}>
              <MaterialCommunityIcons name="account-music" size={52} color="#FFF" />
            </LinearGradient>
          )}
        </Animated.View>

        <Animated.Text style={[styles.bigArtistText, { opacity, transform: [{ translateY: slideY }] }]}>
          {artist || 'Your Artist'}
        </Animated.Text>

        <Animated.Text style={[styles.genreCaption, { opacity }]}>
          You've been obsessed with this artist.{'\n'}We noticed.
        </Animated.Text>
      </View>

      <TouchableOpacity style={styles.nextBtn} onPress={() => { triggerHaptic('medium'); onNext(); }} activeOpacity={0.85}>
        <Text style={styles.nextBtnText}>Keep Going</Text>
        <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const PersonalityPage: React.FC<{ personality: Personality; onNext: () => void }> = ({ personality, onNext }) => {
  const cardScale = useRef(new Animated.Value(0.7)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const emojiScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(100),
      Animated.parallel([
        Animated.spring(cardScale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
      Animated.spring(emojiScale, { toValue: 1, tension: 80, friction: 6, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.page}>
      <Text style={styles.statLabel}>YOUR SOUND PERSONALITY</Text>

      <Animated.View style={[styles.personalityCard, {
        opacity: cardOpacity,
        transform: [{ scale: cardScale }],
        borderColor: personality.color + '50',
      }]}>
        <LinearGradient
          colors={[personality.color + '18', C.bg + 'CC']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.Text style={[styles.personalityEmoji, { transform: [{ scale: emojiScale }] }]}>
          {personality.emoji}
        </Animated.Text>
        <Text style={[styles.personalityName, { color: personality.color }]}>{personality.name}</Text>
        <Text style={styles.personalityTagline}>{personality.tagline}</Text>
      </Animated.View>

      <TouchableOpacity style={styles.nextBtn} onPress={() => { triggerHaptic('medium'); onNext(); }} activeOpacity={0.85}>
        <Text style={styles.nextBtnText}>Keep Going</Text>
        <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const TracksPage: React.FC<{ tracks: { name: string; artist?: string; image?: string | null }[]; onNext: () => void }> = ({ tracks, onNext }) => {
  const itemAnims = useRef(tracks.slice(0, 5).map(() => ({
    opacity: new Animated.Value(0),
    x: new Animated.Value(30),
  }))).current;

  useEffect(() => {
    const animations = itemAnims.map((anim, i) =>
      Animated.sequence([
        Animated.delay(i * 120),
        Animated.parallel([
          Animated.timing(anim.opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.spring(anim.x, { toValue: 0, tension: 60, friction: 9, useNativeDriver: true }),
        ]),
      ])
    );
    Animated.parallel(animations).start();
  }, []);

  const display = tracks.slice(0, 5);

  return (
    <ScrollView style={styles.pageScroll} contentContainerStyle={styles.pageScrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.statLabel}>SONGS THAT DEFINE YOU</Text>
      <Text style={styles.tracksSubtitle}>Your most-played tracks right now</Text>

      <View style={styles.trackList}>
        {display.map((track, i) => (
          <Animated.View
            key={i}
            style={[styles.trackItem, {
              opacity: itemAnims[i]?.opacity ?? 1,
              transform: [{ translateX: itemAnims[i]?.x ?? 0 }],
            }]}
          >
            <View style={styles.trackRank}>
              <Text style={styles.trackRankText}>{i + 1}</Text>
            </View>
            {track.image ? (
              <Image source={{ uri: track.image }} style={styles.trackThumb} resizeMode="cover" />
            ) : null}
            <View style={styles.trackInfo}>
              <Text style={styles.trackName} numberOfLines={1}>{track.name}</Text>
              {track.artist && <Text style={styles.trackArtist} numberOfLines={1}>{track.artist}</Text>}
            </View>
            {!track.image && (
              <MaterialCommunityIcons name="music-note" size={16} color={C.primary + '80'} />
            )}
          </Animated.View>
        ))}
      </View>

      <TouchableOpacity style={styles.nextBtn} onPress={() => { triggerHaptic('medium'); onNext(); }} activeOpacity={0.85}>
        <Text style={styles.nextBtnText}>One More Thing</Text>
        <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" />
      </TouchableOpacity>
    </ScrollView>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const CRAFT_STEPS = [
  { label: 'Scanning your top genres…', icon: 'equalizer' as const },
  { label: 'Mapping your taste DNA…', icon: 'dna' as const },
  { label: 'Calibrating your mood palette…', icon: 'palette-outline' as const },
  { label: 'Syncing your listening patterns…', icon: 'waveform' as const },
  { label: 'Fine-tuning your sound signature…', icon: 'tune-variant' as const },
  { label: 'Profile crafted. You\'re unique.', icon: 'check-circle-outline' as const },
];

const CraftingPage: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const doneScale = useRef(new Animated.Value(0)).current;
  const doneOpacity = useRef(new Animated.Value(0)).current;
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    // Fade in title
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(titleY, { toValue: 0, tension: 60, friction: 9, useNativeDriver: true }),
    ]).start();

    // Drive progress bar over total duration
    const totalMs = CRAFT_STEPS.length * 700;
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: totalMs,
      useNativeDriver: false,
    }).start();

    // Cycle through steps
    let idx = 0;
    const tick = () => {
      if (idx >= CRAFT_STEPS.length - 1) {
        // Reached final step — fade in, then mark done
        Animated.timing(stepOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start(() => {
          setTimeout(() => {
            setDone(true);
            triggerHaptic('success');
            Animated.parallel([
              Animated.spring(doneScale, { toValue: 1, tension: 55, friction: 7, useNativeDriver: true }),
              Animated.timing(doneOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
            ]).start();
          }, 600);
        });
        return;
      }
      // Fade out, swap step, fade in
      Animated.timing(stepOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
        idx += 1;
        setStepIndex(idx);
        Animated.timing(stepOpacity, { toValue: 1, duration: 280, useNativeDriver: true }).start(() => {
          setTimeout(tick, 480);
        });
      });
    };
    const initialDelay = setTimeout(tick, 700);
    return () => clearTimeout(initialDelay);
  }, []);

  const step = CRAFT_STEPS[stepIndex];

  return (
    <View style={styles.page}>
      <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleY }], alignItems: 'center' }}>
        <Text style={styles.statLabel}>BUILDING YOUR PROFILE</Text>
        <Text style={styles.craftTitle}>Crafting your{'\n'}sound identity</Text>
        <Text style={styles.craftSubtitle}>
          Every listen, every skip, every obsession —{'\n'}we're weaving it all together.
        </Text>
      </Animated.View>

      {/* Progress bar */}
      <View style={styles.craftProgressWrap}>
        <View style={styles.craftProgressBg}>
          <Animated.View
            style={[styles.craftProgressFill, {
              width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }]}
          />
        </View>
      </View>

      {/* Cycling step */}
      <Animated.View style={[styles.craftStepRow, { opacity: stepOpacity }]}>
        <MaterialCommunityIcons name={step.icon} size={18} color={C.primary} />
        <Text style={styles.craftStepText}>{step.label}</Text>
      </Animated.View>

      {/* Done CTA */}
      {done && (
        <Animated.View style={{ opacity: doneOpacity, transform: [{ scale: doneScale }], alignItems: 'center', marginTop: Spacing.xxl }}>
          <View style={styles.craftDoneBadge}>
            <MaterialCommunityIcons name="music-circle" size={28} color={C.primary} />
            <Text style={styles.craftDoneTitle}>Your Profile is Ready</Text>
          </View>

          <TouchableOpacity
            style={[styles.nextBtn, { marginTop: Spacing.xl }]}
            onPress={() => { triggerHaptic('medium'); onNext(); }}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>Find My Vibe</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" />
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const PhotoPage: React.FC<{
  onPickPhoto: (uri: string) => void;
  onContinue: () => void;
}> = ({ onPickPhoto, onContinue }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const imageScale = useRef(new Animated.Value(0.9)).current;
  const imageOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const handlePickPhoto = async () => {
    triggerHaptic('medium');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to pick a photo.');
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

    setSelectedImage(uri);
    onPickPhoto(uri);

    Animated.parallel([
      Animated.spring(imageScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(imageOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  };

  return (
    <Animated.View style={[styles.page, { opacity }]}>
      <Text style={styles.statLabel}>FIND YOUR VIBE</Text>
      <Text style={styles.photoTitle}>
        {selectedImage ? 'Looking good! 🎉' : 'Pick a photo, any photo'}
      </Text>
      <Text style={styles.photoSubtitle}>
        {selectedImage
          ? 'Our AI will match songs to the vibe of your photo'
          : 'A selfie, a landscape, a mood — we\'ll find the perfect songs for it'}
      </Text>

      {selectedImage ? (
        <Animated.View style={[styles.selectedImageWrap, { transform: [{ scale: imageScale }], opacity: imageOpacity }]}>
          <Image source={{ uri: selectedImage }} style={styles.selectedImage} resizeMode="cover" />
          <TouchableOpacity style={styles.changePhotoBtn} onPress={handlePickPhoto}>
            <MaterialCommunityIcons name="image-edit" size={16} color={C.white} />
            <Text style={styles.changePhotoBtnText}>Change</Text>
          </TouchableOpacity>
        </Animated.View>
      ) : (
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <TouchableOpacity style={styles.pickPhotoBtn} onPress={handlePickPhoto} activeOpacity={0.85}>
            <LinearGradient colors={[C.primary, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pickPhotoBtnGradient}>
              <MaterialCommunityIcons name="image-plus" size={36} color="#FFF" />
              <Text style={styles.pickPhotoBtnText}>Choose Photo</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      )}

      {selectedImage && (
        <TouchableOpacity
          style={[styles.nextBtn, styles.goLiveBtn]}
          onPress={() => { triggerHaptic('medium'); onContinue(); }}
          activeOpacity={0.85}
        >
          <Text style={styles.nextBtnText}>Pick a Vibe</Text>
          <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const VibePage: React.FC<{
  imageUri: string | null;
  onGoLive: (vibeId: string) => void;
  loading: boolean;
}> = ({ imageUri, onGoLive, loading }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View style={[styles.pageScroll, { opacity }]}>
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={[styles.pageScrollContent, styles.vibePage]}
        showsVerticalScrollIndicator={false}
      >
      <Text style={styles.photoTitle}>Pick your vibe</Text>
      <Text style={styles.photoSubtitle}>
        We'll match songs to the energy of your story
      </Text>

      {imageUri ? (
        <View style={styles.vibePreview}>
          <Image source={{ uri: imageUri }} style={styles.vibePreviewImage} resizeMode="cover" />
        </View>
      ) : null}

      <View style={styles.vibeGridWrap}>
        <VibeGrid
          selected={selected}
          onSelect={(id) => { triggerHaptic('light'); setSelected(id); }}
        />
      </View>

      <TouchableOpacity
        style={[
          styles.nextBtn,
          styles.goLiveBtn,
          (!selected || loading) && styles.btnDisabled,
        ]}
        onPress={() => { if (selected) { triggerHaptic('success'); onGoLive(selected); } }}
        activeOpacity={0.85}
        disabled={!selected || loading}
      >
        {loading ? (
          <Text style={styles.nextBtnText}>Preparing...</Text>
        ) : (
          <>
            <Text style={styles.nextBtnText}>Analyze My Vibe</Text>
            <MaterialCommunityIcons name="lightning-bolt" size={20} color="#FFF" />
          </>
        )}
      </TouchableOpacity>
      </ScrollView>
    </Animated.View>
  );
};

// ─── Main OnboardingScreen ────────────────────────────────────────────────────
const OnboardingScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, markOnboardingComplete } = useAuth();

  const [page, setPage] = useState(0);
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [goLiveLoading, setGoLiveLoading] = useState(false);

  // Slide animation
  const slideX = useRef(new Animated.Value(0)).current;

  // Background orb animations
  const orb1 = useRef(new Animated.Value(0)).current;
  const orb2 = useRef(new Animated.Value(0)).current;

  // Load taste profile on mount
  useEffect(() => {
    const fetchProfile = async (): Promise<TasteProfile | null> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data } = await supabase
          .from('spotify_taste_profiles')
          .select('top_genres, top_artists, top_tracks')
          .eq('user_id', session.user.id)
          .maybeSingle();
        return data ?? null;
      }
      const guestProfile = await loadGuestTasteProfile();
      return (guestProfile as TasteProfile) ?? null;
    };

    const loadProfile = async () => {
      try {
        let data = await fetchProfile();

        // Profiles synced before artwork was added have no image URLs.
        // Re-sync once so existing users get artwork immediately instead of
        // waiting for the 24h auto-refresh. One retry max - if the sync fails
        // or images still aren't there, fall back to the profile without them.
        if (data?.top_artists?.length && !data.top_artists[0]?.image) {
          try {
            const { success } = await syncTasteProfile();
            if (success) {
              data = (await fetchProfile()) ?? data;
            }
          } catch {
            // Keep the image-less profile
          }
        }

        if (data) setProfile(data);
      } catch {
        // Non-fatal - we'll show fallback content
      }
    };
    loadProfile();
  }, []);

  // Background orb loop
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(orb1, { toValue: 1, duration: 4000, useNativeDriver: true }),
        Animated.timing(orb1, { toValue: 0, duration: 4000, useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(orb2, { toValue: 1, duration: 5500, useNativeDriver: true }),
        Animated.timing(orb2, { toValue: 0, duration: 5500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const goToPage = useCallback((nextPage: number) => {
    // Slide current page out to the left
    Animated.timing(slideX, { toValue: -width, duration: 320, useNativeDriver: true }).start(() => {
      slideX.setValue(width); // teleport to right
      setPage(nextPage);
      Animated.spring(slideX, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }).start();
    });
  }, [slideX]);

  const handleNext = useCallback(() => {
    if (page < TOTAL_PAGES - 1) goToPage(page + 1);
  }, [page, goToPage]);

  const handlePickPhoto = (uri: string) => setPhotoUri(uri);

  const handleGoLive = async (vibeId: string) => {
    if (!photoUri) return;
    setGoLiveLoading(true);
    try {
      // Mark onboarding complete before launching analysis
      await markOnboardingComplete();

      const { data: { session } } = await supabase.auth.getSession();
      navigation.navigate('OnboardingAnalyzing', {
        image: photoUri,
        selectedVibe: vibeId,
        userId: session?.user?.id,
        fromOnboarding: true,
      });
    } catch {
      setGoLiveLoading(false);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
  };

  // Derived stats
  const topGenres = profile?.top_genres ?? [];
  const topArtist = profile?.top_artists?.[0]?.name ?? '';
  const topArtistImage = profile?.top_artists?.[0]?.image ?? null;
  const topTracks = (profile?.top_tracks ?? []).map(t => ({ name: t.name, artist: t.artist, image: t.image }));
  const personality = derivePersonality(profile?.top_genres ?? []);

  const renderPage = () => {
    switch (page) {
      case 0: return <WelcomePage user={user} onNext={handleNext} />;
      case 1: return <GenrePage genres={topGenres} onNext={handleNext} />;
      case 2: return <ArtistPage artist={topArtist} image={topArtistImage} onNext={handleNext} />;
      case 3: return <PersonalityPage personality={personality} onNext={handleNext} />;
      case 4: return <TracksPage tracks={topTracks} onNext={handleNext} />;
      case 5: return <CraftingPage onNext={handleNext} />;
      case 6: return <PhotoPage onPickPhoto={handlePickPhoto} onContinue={handleNext} />;
      case 7: return <VibePage imageUri={photoUri} onGoLive={handleGoLive} loading={goLiveLoading} />;
      default: return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* Background gradient */}
      <LinearGradient
        colors={[C.bg, '#180A20', '#0D0010']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Animated orbs */}
      <Animated.View style={[styles.orb1, {
        opacity: orb1.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.35] }),
        transform: [{ translateY: orb1.interpolate({ inputRange: [0, 1], outputRange: [0, -30] }) }],
      }]} />
      <Animated.View style={[styles.orb2, {
        opacity: orb2.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.28] }),
        transform: [{ translateY: orb2.interpolate({ inputRange: [0, 1], outputRange: [0, 25] }) }],
      }]} />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Progress dots */}
        <View style={styles.dotsRow}>
          {Array.from({ length: TOTAL_PAGES }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === page && styles.dotActive,
                i < page && styles.dotDone,
              ]}
            />
          ))}
        </View>

        {/* Page content */}
        <Animated.View style={[styles.pageContainer, { transform: [{ translateX: slideX }] }]}>
          {renderPage()}
        </Animated.View>

      </SafeAreaView>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  safeArea: { flex: 1 },

  // Background orbs
  orb1: {
    position: 'absolute',
    top: -height * 0.08,
    left: -width * 0.25,
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: C.primary,
  },
  orb2: {
    position: 'absolute',
    bottom: -height * 0.08,
    right: -width * 0.25,
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: width * 0.35,
    backgroundColor: C.purple,
  },

  // Dots
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.dimMore,
  },
  dotActive: {
    width: 24,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
  },
  dotDone: {
    backgroundColor: C.primary + '60',
  },

  // Page wrapper
  pageContainer: {
    flex: 1,
  },
  page: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Scrollable page variant - keeps the centered layout but lets content
  // scroll on small devices so the CTA is always reachable
  pageScroll: {
    flex: 1,
  },
  pageScrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Shared
  statLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: C.primary,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
    borderRadius: BorderRadius.round,
    marginTop: Spacing.xxl,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },
  nextBtnText: {
    color: C.white,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  btnDisabled: { opacity: 0.6 },

  // Welcome page
  welcomeIconWrap: { marginBottom: Spacing.xl },
  welcomeIconGradient: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.primary + '30',
  },
  welcomeLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: C.primary,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginBottom: Spacing.sm,
  },
  welcomeName: {
    fontSize: 32,
    fontWeight: '800',
    color: C.white,
    textAlign: 'center',
    marginBottom: Spacing.md,
    letterSpacing: -0.5,
  },
  welcomeSubtitle: {
    fontSize: 15,
    color: C.dim,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  statRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
  },
  statChipText: { color: C.white, fontSize: 13, fontWeight: '500' },

  // Genre page
  bigRevealWrap: { alignItems: 'center', width: '100%', marginVertical: Spacing.lg },
  bigGenreCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: C.primary + '30',
  },
  bigGenreText: {
    fontSize: 48,
    fontWeight: '900',
    color: C.white,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: Spacing.lg,
    textShadowColor: C.primary + '80',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  genreCaption: {
    fontSize: 14,
    color: C.dim,
    textAlign: 'center',
    lineHeight: 21,
  },
  genreRunnerUpRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: Spacing.xl,
  },
  genreRunnerUpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
    maxWidth: width * 0.42,
  },
  genreRunnerUpRank: { color: C.primary, fontSize: 12, fontWeight: '800' },
  genreRunnerUpText: { color: C.white, fontSize: 13, fontWeight: '500', flexShrink: 1 },

  // Artist page
  artistAvatarWrap: { alignItems: 'center', marginBottom: Spacing.lg, position: 'relative' },
  artistGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: C.primary,
    top: -5,
    left: -5,
  },
  artistAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistAvatarImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: C.primary + '60',
  },
  bigArtistText: {
    fontSize: 36,
    fontWeight: '900',
    color: C.white,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },

  // Personality page
  personalityCard: {
    width: '100%',
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    padding: Spacing.xl,
    alignItems: 'center',
    overflow: 'hidden',
    marginVertical: Spacing.lg,
  },
  personalityEmoji: { fontSize: 56, marginBottom: Spacing.md },
  personalityName: { fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: Spacing.md, letterSpacing: -0.3 },
  personalityTagline: { fontSize: 14, color: C.dim, textAlign: 'center', lineHeight: 22 },

  // Tracks page
  tracksSubtitle: {
    fontSize: 13,
    color: C.dim,
    textAlign: 'center',
    marginTop: -Spacing.sm,
    marginBottom: Spacing.lg,
  },
  trackList: { width: '100%', gap: Spacing.sm },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  trackRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackRankText: { color: C.primary, fontWeight: '800', fontSize: 13 },
  trackThumb: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    backgroundColor: C.card,
  },
  trackInfo: { flex: 1 },
  trackName: { color: C.white, fontWeight: '600', fontSize: 14 },
  trackArtist: { color: C.dim, fontSize: 12, marginTop: 2 },

  // Crafting page
  craftTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: C.white,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
    lineHeight: 38,
  },
  craftSubtitle: {
    fontSize: 14,
    color: C.dim,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: Spacing.xxl,
  },
  craftProgressWrap: {
    width: '100%',
    marginBottom: Spacing.lg,
  },
  craftProgressBg: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  craftProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  craftStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.sm,
  },
  craftStepText: {
    color: C.dim,
    fontSize: 13,
    fontWeight: '500',
  },
  craftDoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: C.primary + '18',
    borderWidth: 1,
    borderColor: C.primary + '40',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.round,
  },
  craftDoneTitle: {
    color: C.white,
    fontWeight: '700',
    fontSize: 16,
  },

  // Photo page
  vibePage: {
    justifyContent: 'flex-start',
    paddingTop: Spacing.md,
  },
  photoTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: C.white,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    letterSpacing: -0.3,
  },
  photoSubtitle: {
    fontSize: 14,
    color: C.dim,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  pickPhotoBtn: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  pickPhotoBtnGradient: {
    width: 180,
    height: 180,
    borderRadius: BorderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  pickPhotoBtnText: { color: C.white, fontWeight: '700', fontSize: 15 },
  selectedImageWrap: {
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: C.primary + '60',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  selectedImage: { width: '100%', height: '100%' },
  changePhotoBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: C.border,
  },
  changePhotoBtnText: { color: C.white, fontWeight: '600', fontSize: 13 },
  goLiveBtn: {
    paddingHorizontal: 32,
    backgroundColor: C.primary,
  },

  // Vibe page
  vibePreview: {
    width: 240,
    height: 240,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  vibePreviewImage: { width: '100%', height: '100%' },
  vibeGridWrap: {
    width: '100%',
    marginBottom: Spacing.sm,
  },
  vibeCard: {
    aspectRatio: 1,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  vibeCardSelected: {
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  vibeCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  vibeCardContent: {
    flex: 1,
    padding: Spacing.md,
    justifyContent: 'flex-end',
    gap: 3,
  },
  vibeCardTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  vibeCardSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
    letterSpacing: 0.2,
  },
  vibeCheck: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Brand
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingBottom: Spacing.sm,
  },
  brandText: { color: C.dimMore, fontSize: 11, fontWeight: '600', letterSpacing: 1 },
});

export default OnboardingScreen;
