import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Alert,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../lib/AuthContext';
import { trackEvent } from '../../lib/posthog';
import { triggerHaptic } from '../../lib/utils/haptics';
import { Spacing, BorderRadius } from '../../lib/designSystem';
import {
  GENRE_OPTIONS,
  ERA_OPTIONS,
  MAX_TASTE_ARTISTS,
  MAX_TASTE_GENRES,
  MAX_TASTE_ERAS,
  TasteSaveError,
  searchArtists,
  saveManualTasteProfile,
  loadManualTasteProfile,
} from '../../lib/taste';
import type { TasteArtist } from '../../lib/taste';

type RootStackParamList = {
  TastePicker: { returnTo?: 'back' } | undefined;
  Onboarding: undefined;
  MainTabs: undefined;
};

// Design tokens, same palette as the rest of the onboarding flow.
const C = {
  bg: '#221019',
  primary: '#f4258c',
  purple: '#8b5cf6',
  white: '#FFFFFF',
  dim: 'rgba(255,255,255,0.55)',
  dimMore: 'rgba(255,255,255,0.3)',
  card: 'rgba(255,255,255,0.06)',
  cardRaised: 'rgba(255,255,255,0.1)',
  border: 'rgba(255,255,255,0.12)',
  error: '#FF6B6B',
};

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;
// A search that never answers must not leave a spinner running forever.
const SEARCH_TIMEOUT_MS = 10000;
const SEARCH_LIMIT = 8;
const LIMIT_HINT_MS = 2200;

const SEARCH_ERROR_NETWORK = "Couldn't reach Spotify. Check your connection and try again.";
const SEARCH_ERROR_TIMEOUT = 'Spotify took too long to answer. Try again.';

// "hip hop" -> "Hip Hop", "r&b" -> "R&B", "k-pop" -> "K-Pop"
const formatGenre = (genre: string) =>
  genre.replace(/(^|[\s&-])([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());

const uniqueStrings = (values: string[]) => Array.from(new Set(values));

// Round artist image with a gradient-free placeholder: Spotify has no artwork
// for some smaller artists, and a broken image would look like a bug.
const ArtistAvatar: React.FC<{ uri: string | null; size: number }> = ({ uri, size }) => {
  const radius = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[styles.avatarImage, radius]} resizeMode="cover" />;
  }
  return (
    <View style={[styles.avatarPlaceholder, radius]}>
      <MaterialCommunityIcons name="account-music" size={Math.round(size * 0.55)} color={C.primary} />
    </View>
  );
};

const TastePickerScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'TastePicker'>>();
  const returnTo = route.params?.returnTo;
  const source = returnTo === 'back' ? 'profile' : 'onboarding';
  const { user, onboardingComplete } = useAuth();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TasteArtist[]>([]);
  // The query the current results (or error) answer, for the empty-state copy.
  const [searchedFor, setSearchedFor] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedArtists, setSelectedArtists] = useState<TasteArtist[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedEras, setSelectedEras] = useState<string[]>([]);
  const [limitHint, setLimitHint] = useState<'artists' | 'genres' | 'eras' | null>(null);
  const [saving, setSaving] = useState(false);

  // Only the latest search may touch state: a slow early response must not
  // overwrite the results of a later, more specific query.
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const limitHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    trackEvent('taste_picker_shown', { source });
  }, [source]);

  // Restore a profile picked earlier on this device, so editing from Profile
  // starts from the current picks instead of a blank screen.
  useEffect(() => {
    let cancelled = false;
    loadManualTasteProfile().then((profile) => {
      if (!profile || cancelled) return;
      setSelectedArtists(
        profile.top_artists.slice(0, MAX_TASTE_ARTISTS).map((a) => ({
          id: a.id,
          name: a.name,
          genres: a.genres ?? [],
          image: a.image ?? null,
        }))
      );
      setSelectedGenres((profile.picked_genres ?? []).slice(0, MAX_TASTE_GENRES));
      setSelectedEras((profile.picked_eras ?? []).slice(0, MAX_TASTE_ERAS));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (limitHintTimer.current) clearTimeout(limitHintTimer.current);
    };
  }, []);

  const runSearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    setSearching(true);
    setSearchError(null);
    try {
      const artists = await searchArtists(q, { limit: SEARCH_LIMIT, signal: controller.signal });
      if (requestId !== requestIdRef.current) return;
      setResults(artists);
      setSearchedFor(q);
    } catch (err) {
      // Superseded by a newer query (which aborted this one): nothing to show.
      if (requestId !== requestIdRef.current) return;
      setResults([]);
      setSearchedFor(q);
      setSearchError(controller.signal.aborted ? SEARCH_ERROR_TIMEOUT : SEARCH_ERROR_NETWORK);
      console.warn('Artist search failed:', err);
    } finally {
      clearTimeout(timeout);
      if (requestId === requestIdRef.current) setSearching(false);
    }
  }, []);

  // Debounced search: wait for a pause in typing and at least two characters.
  useEffect(() => {
    const q = query.trim();
    if (q.length < SEARCH_MIN_CHARS) {
      requestIdRef.current += 1;
      abortRef.current?.abort();
      setSearching(false);
      setSearchError(null);
      setResults([]);
      setSearchedFor('');
      return;
    }
    const timer = setTimeout(() => runSearch(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const flashLimitHint = (kind: 'artists' | 'genres' | 'eras') => {
    setLimitHint(kind);
    if (limitHintTimer.current) clearTimeout(limitHintTimer.current);
    limitHintTimer.current = setTimeout(() => setLimitHint(null), LIMIT_HINT_MS);
  };

  const isArtistSelected = (id: string) => selectedArtists.some((a) => a.id === id);

  const removeArtist = (id: string) => {
    triggerHaptic('light');
    setSelectedArtists((prev) => prev.filter((a) => a.id !== id));
  };

  const toggleArtist = (artist: TasteArtist) => {
    if (isArtistSelected(artist.id)) {
      removeArtist(artist.id);
      return;
    }
    if (selectedArtists.length >= MAX_TASTE_ARTISTS) {
      triggerHaptic('warning');
      flashLimitHint('artists');
      return;
    }
    const next = [...selectedArtists, artist];
    setSelectedArtists(next);
    triggerHaptic('light');
    trackEvent('taste_artist_selected', { count: next.length });
    // The pick lives on as a chip; clear the search so the next name can be
    // typed straight away. Once the slots are full, get the keyboard out of
    // the way so the genres below are visible.
    setQuery('');
    setResults([]);
    setSearchedFor('');
    if (next.length >= MAX_TASTE_ARTISTS) Keyboard.dismiss();
  };

  const toggleGenre = (genre: string) => {
    if (selectedGenres.includes(genre)) {
      triggerHaptic('light');
      setSelectedGenres((prev) => prev.filter((g) => g !== genre));
      return;
    }
    if (selectedGenres.length >= MAX_TASTE_GENRES) {
      triggerHaptic('warning');
      flashLimitHint('genres');
      return;
    }
    triggerHaptic('light');
    setSelectedGenres((prev) => [...prev, genre]);
  };

  // Genres of the picked artists come first: they are the most likely picks.
  // A chosen genre stays visible even after its artist is removed.
  const artistGenres = useMemo(
    () => uniqueStrings(selectedArtists.flatMap((a) => a.genres)),
    [selectedArtists]
  );
  const moreGenres = useMemo(() => {
    const orphaned = selectedGenres.filter((g) => !artistGenres.includes(g) && !GENRE_OPTIONS.includes(g));
    return [...orphaned, ...GENRE_OPTIONS.filter((g) => !artistGenres.includes(g))];
  }, [artistGenres, selectedGenres]);

  const toggleEra = (era: string) => {
    if (selectedEras.includes(era)) {
      triggerHaptic('light');
      setSelectedEras((prev) => prev.filter((e) => e !== era));
      return;
    }
    if (selectedEras.length >= MAX_TASTE_ERAS) {
      triggerHaptic('warning');
      flashLimitHint('eras');
      return;
    }
    triggerHaptic('light');
    setSelectedEras((prev) => [...prev, era]);
  };

  const canSave =
    selectedArtists.length > 0 || selectedGenres.length > 0 || selectedEras.length > 0;

  const leave = useCallback(() => {
    if (returnTo === 'back') {
      navigation.goBack();
      return;
    }
    // Guests always go through onboarding: onboardingComplete belongs to
    // registered sessions and must not short-circuit the guest path.
    navigation.reset({
      index: 0,
      routes: [{ name: user && onboardingComplete ? 'MainTabs' : 'Onboarding' }],
    });
  }, [navigation, returnTo, user, onboardingComplete]);

  const handleSkip = () => {
    if (saving) return;
    trackEvent('taste_picker_skipped', { source });
    leave();
  };

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    Keyboard.dismiss();
    try {
      await saveManualTasteProfile({
        artists: selectedArtists,
        genres: selectedGenres,
        eras: selectedEras,
      });
      trackEvent('taste_picker_completed', {
        artists: selectedArtists.length,
        genres: selectedGenres.length,
        eras: selectedEras.length,
        source,
      });
      triggerHaptic('success');
      leave();
    } catch (err: any) {
      const stage = err instanceof TasteSaveError ? err.stage : 'local';
      trackEvent('taste_picker_save_failed', { source, stage, error: err?.message ?? String(err) });
      setSaving(false);
      if (stage === 'server') {
        // The local copy is written; only the account sync failed.
        Alert.alert(
          "Couldn't sync your taste",
          'Your picks are saved on this phone, but syncing them to your account failed. Try again?',
          [
            { text: 'Continue anyway', style: 'cancel', onPress: leave },
            { text: 'Try again', onPress: () => { handleSave(); } },
          ]
        );
      } else {
        Alert.alert("Couldn't save your taste", 'Something went wrong on this phone. Please try again.');
      }
    }
  };

  const trimmedQuery = query.trim();
  const showResults = results.length > 0 && !searching && !searchError;
  const showNoResults =
    !searching && !searchError && results.length === 0 && searchedFor.length > 0 && trimmedQuery.length >= SEARCH_MIN_CHARS;
  const showSearchHint =
    trimmedQuery.length < SEARCH_MIN_CHARS && selectedArtists.length === 0;

  const summary = [
    selectedArtists.length > 0
      ? `${selectedArtists.length} artist${selectedArtists.length === 1 ? '' : 's'}`
      : null,
    selectedGenres.length > 0
      ? `${selectedGenres.length} genre${selectedGenres.length === 1 ? '' : 's'}`
      : null,
    selectedEras.length > 0
      ? `${selectedEras.length} era${selectedEras.length === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean).join(', ');

  const renderGenreChip = (genre: string) => {
    const selected = selectedGenres.includes(genre);
    return (
      <TouchableOpacity
        key={genre}
        style={[styles.genreChip, selected && styles.genreChipSelected]}
        onPress={() => toggleGenre(genre)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        {selected && <MaterialCommunityIcons name="check" size={14} color={C.primary} />}
        <Text style={[styles.genreChipText, selected && styles.genreChipTextSelected]}>
          {formatGenre(genre)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topRow}>
              {returnTo === 'back' ? (
                <TouchableOpacity style={styles.backBtn} onPress={handleSkip} hitSlop={12} accessibilityLabel="Back">
                  <MaterialCommunityIcons name="chevron-left" size={28} color={C.white} />
                </TouchableOpacity>
              ) : (
                <View style={styles.backBtn} />
              )}
              <Text style={styles.brandLabel}>YOUR MUSIC TASTE</Text>
              <View style={styles.backBtn} />
            </View>

            {/* Step 1: artists */}
            <View style={styles.stepHeader}>
              <Text style={styles.stepLabel}>STEP 1</Text>
              <Text style={styles.stepCount}>{selectedArtists.length} of {MAX_TASTE_ARTISTS}</Text>
            </View>
            <Text style={styles.title}>Which artists do you love?</Text>
            <Text style={styles.subtitle}>
              Pick up to {MAX_TASTE_ARTISTS}. Every match gets tuned to them.
            </Text>

            <View style={styles.searchBox}>
              <MaterialCommunityIcons name="magnify" size={20} color={C.dim} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search any artist"
                placeholderTextColor={C.dimMore}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => { if (trimmedQuery.length >= SEARCH_MIN_CHARS) runSearch(trimmedQuery); }}
                editable={!saving}
                accessibilityLabel="Search artists"
              />
              {searching ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : query.length > 0 ? (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                  <MaterialCommunityIcons name="close-circle" size={18} color={C.dim} />
                </TouchableOpacity>
              ) : null}
            </View>

            {selectedArtists.length > 0 && (
              <View style={styles.chipRow}>
                {selectedArtists.map((artist) => (
                  <TouchableOpacity
                    key={artist.id}
                    style={styles.artistChip}
                    onPress={() => removeArtist(artist.id)}
                    activeOpacity={0.7}
                    accessibilityLabel={`Remove ${artist.name}`}
                  >
                    <ArtistAvatar uri={artist.image} size={22} />
                    <Text style={styles.artistChipText} numberOfLines={1}>{artist.name}</Text>
                    <MaterialCommunityIcons name="close" size={14} color={C.dim} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {limitHint === 'artists' && (
              <Text style={styles.limitHint}>
                That's {MAX_TASTE_ARTISTS} already. Remove one to swap it out.
              </Text>
            )}

            {searchError && (
              <View style={styles.statusRow}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={C.error} />
                <Text style={styles.statusErrorText}>{searchError}</Text>
                <TouchableOpacity onPress={() => runSearch(searchedFor || trimmedQuery)} hitSlop={8}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {showNoResults && (
              <Text style={styles.statusText}>
                No artists found for "{searchedFor}". Try another spelling.
              </Text>
            )}

            {showSearchHint && !searchError && (
              <Text style={styles.statusText}>
                Type a name to search Spotify's catalog.
              </Text>
            )}

            {showResults && (
              <View style={styles.resultsList}>
                {results.map((artist) => {
                  const selected = isArtistSelected(artist.id);
                  return (
                    <TouchableOpacity
                      key={artist.id}
                      style={[styles.resultRow, selected && styles.resultRowSelected]}
                      onPress={() => toggleArtist(artist)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <ArtistAvatar uri={artist.image} size={44} />
                      <View style={styles.resultText}>
                        <Text style={styles.resultName} numberOfLines={1}>{artist.name}</Text>
                        {artist.genres.length > 0 && (
                          <Text style={styles.resultGenres} numberOfLines={1}>
                            {artist.genres.slice(0, 2).map(formatGenre).join(', ')}
                          </Text>
                        )}
                      </View>
                      <MaterialCommunityIcons
                        name={selected ? 'check-circle' : 'plus-circle-outline'}
                        size={22}
                        color={selected ? C.primary : C.dimMore}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Step 2: genres */}
            <View style={[styles.stepHeader, styles.stepHeaderSpaced]}>
              <Text style={styles.stepLabel}>STEP 2</Text>
              <Text style={styles.stepCount}>{selectedGenres.length} of {MAX_TASTE_GENRES}</Text>
            </View>
            <Text style={styles.title}>Pick up to {MAX_TASTE_GENRES} genres</Text>
            <Text style={styles.subtitle}>
              {artistGenres.length > 0
                ? 'Your artists\' genres come first. Tap any that sound like you.'
                : 'Tap the ones that sound like you.'}
            </Text>

            {limitHint === 'genres' && (
              <Text style={styles.limitHint}>
                That's {MAX_TASTE_GENRES} already. Remove one to swap it out.
              </Text>
            )}

            {artistGenres.length > 0 && (
              <>
                <Text style={styles.groupLabel}>From your artists</Text>
                <View style={styles.chipRow}>{artistGenres.map(renderGenreChip)}</View>
                <Text style={styles.groupLabel}>More</Text>
              </>
            )}
            <View style={styles.chipRow}>{moreGenres.map(renderGenreChip)}</View>

            {/* Step 3: eras. A decade is a stronger steer than a genre alone
                and costs one tap, so it sits last but is worth asking for. */}
            <View style={[styles.stepHeader, styles.stepHeaderSpaced]}>
              <Text style={styles.stepLabel}>STEP 3</Text>
              <Text style={styles.stepCount}>{selectedEras.length} of {MAX_TASTE_ERAS}</Text>
            </View>
            <Text style={styles.title}>Pick up to {MAX_TASTE_ERAS} decades</Text>
            <Text style={styles.subtitle}>Where does your music live? Optional.</Text>

            {limitHint === 'eras' && (
              <Text style={styles.limitHint}>
                That's {MAX_TASTE_ERAS} already. Remove one to swap it out.
              </Text>
            )}

            <View style={styles.chipRow}>
              {ERA_OPTIONS.map((era) => {
                const selected = selectedEras.includes(era);
                return (
                  <TouchableOpacity
                    key={era}
                    style={[styles.genreChip, selected && styles.genreChipSelected]}
                    onPress={() => toggleEra(era)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    {selected && <MaterialCommunityIcons name="check" size={14} color={C.primary} />}
                    <Text style={[styles.genreChipText, selected && styles.genreChipTextSelected]}>
                      {era}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
            <Text style={styles.footerSummary} numberOfLines={1}>
              {summary ? `${summary} picked` : 'Pick at least one artist, genre or decade'}
            </Text>
            <TouchableOpacity
              style={[styles.saveBtn, (!canSave || saving) && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!canSave || saving}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave || saving }}
            >
              {saving ? (
                <ActivityIndicator size="small" color={C.white} />
              ) : (
                <>
                  <Text style={styles.saveBtnText}>Save my taste</Text>
                  <MaterialCommunityIcons name="arrow-right" size={20} color={C.white} />
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSkip} disabled={saving} hitSlop={8} style={styles.skipBtn}>
              <Text style={styles.skipText}>{returnTo === 'back' ? 'Cancel' : 'Skip for now'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  brandLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: C.primary,
    letterSpacing: 2.5,
  },

  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  stepHeaderSpaced: { marginTop: Spacing.xxl },
  stepLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: C.purple,
    letterSpacing: 2,
  },
  stepCount: { fontSize: 12, fontWeight: '600', color: C.dim },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: C.white,
    letterSpacing: -0.4,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: C.dim,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: C.cardRaised,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    minHeight: 50,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: C.white,
    paddingVertical: Spacing.sm + 4,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  artistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primary + '22',
    borderWidth: 1,
    borderColor: C.primary + '66',
    paddingLeft: 5,
    paddingRight: Spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: BorderRadius.round,
    maxWidth: '100%',
  },
  artistChipText: { color: C.white, fontSize: 13, fontWeight: '600', flexShrink: 1 },

  avatarImage: { backgroundColor: C.card },
  avatarPlaceholder: {
    backgroundColor: C.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },

  limitHint: { color: C.primary, fontSize: 12, fontWeight: '600', marginTop: Spacing.sm },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.md,
  },
  statusErrorText: { flex: 1, color: C.error, fontSize: 13, lineHeight: 18 },
  retryText: { color: C.primary, fontSize: 13, fontWeight: '700' },
  statusText: { color: C.dim, fontSize: 13, lineHeight: 18, marginTop: Spacing.md },

  resultsList: {
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: BorderRadius.lg,
    backgroundColor: C.card,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  resultRowSelected: { backgroundColor: C.primary + '14' },
  resultText: { flex: 1 },
  resultName: { color: C.white, fontSize: 15, fontWeight: '600' },
  resultGenres: { color: C.dim, fontSize: 12, marginTop: 2 },

  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.dimMore,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: Spacing.md,
    marginBottom: -Spacing.xs,
  },
  genreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
    borderRadius: BorderRadius.round,
  },
  genreChipSelected: {
    backgroundColor: C.primary + '22',
    borderColor: C.primary,
  },
  genreChipText: { color: C.white, fontSize: 14, fontWeight: '500' },
  genreChipTextSelected: { color: C.primary, fontWeight: '700' },

  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bg,
    alignItems: 'center',
  },
  footerSummary: { color: C.dim, fontSize: 12, marginBottom: Spacing.sm },
  saveBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.primary,
    paddingVertical: 15,
    borderRadius: BorderRadius.round,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 10,
  },
  saveBtnDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  saveBtnText: { color: C.white, fontWeight: '700', fontSize: 16, letterSpacing: 0.3 },
  skipBtn: { paddingVertical: Spacing.sm + 4 },
  skipText: { color: C.dim, fontSize: 14, fontWeight: '600' },
});

export default TastePickerScreen;
