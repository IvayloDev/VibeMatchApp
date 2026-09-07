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
import { OB, OnboardingHeader, OnboardingIntro, OnboardingFooter } from '../../lib/components/OnboardingChrome';
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

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;
// A search that never answers must not leave a spinner running forever.
const SEARCH_TIMEOUT_MS = 10000;
const SEARCH_LIMIT = 8;
const LIMIT_HINT_MS = 2200;

const SEARCH_ERROR_NETWORK = "Couldn't reach Spotify. Check your connection and try again.";
const SEARCH_ERROR_TIMEOUT = 'Spotify took too long to answer. Try again.';

// Selected chip fill: the brand pink at 18% over the dark ground.
const PRIMARY_TINT = OB.primary + '2E';

// Gap between a section's label row and its chips.
const LABEL_GAP = Spacing.sm + Spacing.xs;

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
      <MaterialCommunityIcons name="account-music" size={Math.round(size * 0.55)} color={OB.primary} />
    </View>
  );
};

// Section label on the left, "n of max" on the right.
const SectionLabel: React.FC<{ label: string; count: number; max: number }> = ({ label, count, max }) => (
  <View style={styles.sectionLabelRow}>
    <Text style={styles.sectionLabel}>{label}</Text>
    <Text style={styles.sectionCount}>
      {count} of {max}
    </Text>
  </View>
);

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
  // Artists are optional, so the search stays folded away until asked for.
  const [artistsOpen, setArtistsOpen] = useState(false);

  // Only the latest search may touch state: a slow early response must not
  // overwrite the results of a later, more specific query.
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const limitHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  // Focus the search only when the user opened the section by tapping, not
  // when it opened on its own because a restored profile had artists.
  const focusSearchOnOpen = useRef(false);

  useEffect(() => {
    trackEvent('taste_picker_shown', { source });
  }, [source]);

  // Restore a profile picked earlier on this device, so editing from Profile
  // starts from the current picks instead of a blank screen.
  useEffect(() => {
    let cancelled = false;
    loadManualTasteProfile().then((profile) => {
      if (!profile || cancelled) return;
      const artists = profile.top_artists.slice(0, MAX_TASTE_ARTISTS).map((a) => ({
        id: a.id,
        name: a.name,
        genres: a.genres ?? [],
        image: a.image ?? null,
      }));
      setSelectedArtists(artists);
      if (artists.length > 0) setArtistsOpen(true);
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

  // The input only mounts once the section is open, so focus after that render.
  useEffect(() => {
    if (!artistsOpen || !focusSearchOnOpen.current) return;
    focusSearchOnOpen.current = false;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [artistsOpen]);

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

  const openArtists = () => {
    if (saving) return;
    triggerHaptic('light');
    focusSearchOnOpen.current = true;
    setArtistsOpen(true);
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
    // the way so the rest of the screen is visible.
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

  const renderChip = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={key}
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {selected && <MaterialCommunityIcons name="check" size={16} color={OB.primary} />}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderGenreChip = (genre: string) =>
    renderChip(genre, formatGenre(genre), selectedGenres.includes(genre), () => toggleGenre(genre));

  const selectedArtistChips = selectedArtists.length > 0 && (
    <View style={styles.chipWrap}>
      {selectedArtists.map((artist) => (
        <TouchableOpacity
          key={artist.id}
          style={styles.artistChip}
          onPress={() => removeArtist(artist.id)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${artist.name}`}
        >
          <ArtistAvatar uri={artist.image} size={28} />
          <Text style={styles.artistChipText} numberOfLines={1}>{artist.name}</Text>
          <MaterialCommunityIcons name="close" size={16} color={OB.textDim} />
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {returnTo === 'back' ? (
            <OnboardingHeader onBack={handleSkip} />
          ) : (
            <OnboardingHeader step={1} total={2} onSkip={handleSkip} skipLabel="Skip" />
          )}

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <OnboardingIntro
              title="What do you listen to?"
              subtitle="Tap what sounds like you. Every match gets tuned to it."
            />

            <View style={styles.body}>
              {/* Decades first: one tap, and a stronger steer than a genre alone. */}
              <View style={styles.section}>
                <SectionLabel label="Decades" count={selectedEras.length} max={MAX_TASTE_ERAS} />
                {limitHint === 'eras' && (
                  <Text style={styles.limitHint}>
                    That's {MAX_TASTE_ERAS} already. Remove one to swap it out.
                  </Text>
                )}
                <View style={styles.chipWrap}>
                  {ERA_OPTIONS.map((era) =>
                    renderChip(era, era, selectedEras.includes(era), () => toggleEra(era))
                  )}
                </View>
              </View>

              {/* Genres */}
              <View style={styles.section}>
                <SectionLabel label="Genres" count={selectedGenres.length} max={MAX_TASTE_GENRES} />
                {limitHint === 'genres' && (
                  <Text style={styles.limitHint}>
                    That's {MAX_TASTE_GENRES} already. Remove one to swap it out.
                  </Text>
                )}
                {artistGenres.length > 0 ? (
                  <>
                    <Text style={styles.groupLabel}>From your artists</Text>
                    <View style={styles.chipWrap}>{artistGenres.map(renderGenreChip)}</View>
                    <Text style={styles.groupLabel}>More</Text>
                    <View style={styles.chipWrap}>{moreGenres.map(renderGenreChip)}</View>
                  </>
                ) : (
                  <View style={styles.chipWrap}>{moreGenres.map(renderGenreChip)}</View>
                )}
              </View>

              {/* Artists, optional and folded away until asked for. */}
              <View style={styles.section}>
                {artistsOpen ? (
                  <>
                    <SectionLabel label="Artists" count={selectedArtists.length} max={MAX_TASTE_ARTISTS} />

                    <View style={styles.searchBox}>
                      <MaterialCommunityIcons name="magnify" size={20} color={OB.textDim} />
                      <TextInput
                        ref={searchInputRef}
                        style={styles.searchInput}
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Search any artist"
                        placeholderTextColor={OB.textFaint}
                        autoCapitalize="words"
                        autoCorrect={false}
                        returnKeyType="search"
                        onSubmitEditing={() => { if (trimmedQuery.length >= SEARCH_MIN_CHARS) runSearch(trimmedQuery); }}
                        editable={!saving}
                        accessibilityLabel="Search artists"
                      />
                      {searching ? (
                        <ActivityIndicator size="small" color={OB.primary} />
                      ) : query.length > 0 ? (
                        <TouchableOpacity
                          onPress={() => setQuery('')}
                          hitSlop={10}
                          accessibilityRole="button"
                          accessibilityLabel="Clear search"
                        >
                          <MaterialCommunityIcons name="close-circle" size={18} color={OB.textDim} />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {selectedArtistChips}

                    {limitHint === 'artists' && (
                      <Text style={styles.limitHint}>
                        That's {MAX_TASTE_ARTISTS} already. Remove one to swap it out.
                      </Text>
                    )}

                    {searchError && (
                      <View style={styles.statusRow}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={OB.error} />
                        <Text style={styles.statusErrorText}>{searchError}</Text>
                        <TouchableOpacity
                          onPress={() => runSearch(searchedFor || trimmedQuery)}
                          hitSlop={8}
                          accessibilityRole="button"
                        >
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
                                color={selected ? OB.primary : OB.textFaint}
                              />
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    {selectedArtistChips}
                    <TouchableOpacity
                      style={styles.addArtistsRow}
                      onPress={openArtists}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Add artists you love"
                      accessibilityHint="Optional. Search Spotify's catalog."
                    >
                      <View style={styles.addArtistsText}>
                        <Text style={styles.addArtistsTitle}>Add artists you love</Text>
                        <Text style={styles.addArtistsCaption}>Optional. Search Spotify's catalog.</Text>
                      </View>
                      <MaterialCommunityIcons name="plus" size={22} color={OB.primary} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </ScrollView>

          <OnboardingFooter
            summary={summary ? `${summary} picked` : 'Pick at least one to continue'}
            ctaLabel="Continue"
            onPress={handleSave}
            disabled={!canSave}
            loading={saving}
            bottomInset={insets.bottom}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: OB.bg },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: Spacing.xl },
  body: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    gap: Spacing.lg,
  },
  section: { gap: LABEL_GAP },

  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionLabel: { color: OB.text, fontSize: OB.body, fontWeight: '700' },
  sectionCount: { color: OB.textFaint, fontSize: OB.caption, fontWeight: '600' },
  groupLabel: { color: OB.textFaint, fontSize: OB.caption, fontWeight: '600' },

  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: OB.hit,
    paddingHorizontal: Spacing.md,
    borderRadius: 22,
    backgroundColor: OB.surface,
    borderWidth: 1.5,
    borderColor: OB.border,
  },
  chipSelected: {
    backgroundColor: PRIMARY_TINT,
    borderColor: OB.primary,
  },
  chipText: { color: OB.text, fontSize: OB.body, fontWeight: '500' },
  chipTextSelected: { fontWeight: '600' },

  artistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: OB.hit,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    borderRadius: 22,
    backgroundColor: PRIMARY_TINT,
    borderWidth: 1.5,
    borderColor: OB.primary,
    maxWidth: '100%',
  },
  artistChipText: { color: OB.text, fontSize: OB.body, fontWeight: '600', flexShrink: 1 },

  avatarImage: { backgroundColor: OB.surface },
  avatarPlaceholder: {
    backgroundColor: PRIMARY_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  addArtistsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: OB.surface,
    borderWidth: 1,
    borderColor: OB.border,
  },
  addArtistsText: { flex: 1, gap: 2 },
  addArtistsTitle: { color: OB.text, fontSize: OB.body, fontWeight: '600' },
  addArtistsCaption: { color: OB.textDim, fontSize: OB.caption },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 52,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: OB.surfaceRaised,
    borderWidth: 1,
    borderColor: OB.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: OB.text,
    paddingVertical: Spacing.sm + 4,
  },

  limitHint: { color: OB.primary, fontSize: OB.caption, fontWeight: '600' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusErrorText: { flex: 1, color: OB.error, fontSize: OB.caption, lineHeight: 18 },
  retryText: { color: OB.primary, fontSize: OB.caption, fontWeight: '700' },
  statusText: { color: OB.textDim, fontSize: OB.caption, lineHeight: 18 },

  resultsList: {
    borderWidth: 1,
    borderColor: OB.border,
    borderRadius: BorderRadius.lg,
    backgroundColor: OB.surface,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: OB.border,
  },
  resultRowSelected: { backgroundColor: PRIMARY_TINT },
  resultText: { flex: 1 },
  resultName: { color: OB.text, fontSize: OB.body, fontWeight: '600' },
  resultGenres: { color: OB.textDim, fontSize: OB.caption, marginTop: 2 },
});

export default TastePickerScreen;
