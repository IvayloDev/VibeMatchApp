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
  OB,
  OnboardingHeader,
  OnboardingIntro,
  OnboardingFooter,
  Chip,
  SectionHeader,
} from '../../lib/components/OnboardingChrome';
import { DecadeDial } from '../../lib/components/DecadeDial';
import {
  GENRE_OPTIONS,
  MAX_TASTE_ARTISTS,
  MAX_TASTE_GENRES,
  MAX_TASTE_ERAS,
  TasteSaveError,
  searchArtists,
  suggestArtists,
  saveManualTasteProfile,
  loadManualTasteProfile,
} from '../../lib/taste';
import type { TasteArtist, ArtistSuggestions } from '../../lib/taste';

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

// Brand pink at 18% over the dark ground, for the avatar placeholder and the
// picked result row.
const PRIMARY_TINT = OB.primary + '2E';

// Gap between a section's label row and its chips.
const LABEL_GAP = Spacing.sm + Spacing.xs;

// How many picks the footer names before it switches to "+n".
const SUMMARY_NAMES = 3;

// The genres most people reach for, shown before "More". Order is by how
// often each was picked in the old onboarding, broadest first.
const FEATURED_GENRES: readonly string[] = [
  'pop', 'hip hop', 'rock', 'r&b', 'electronic', 'indie', 'latin', 'jazz', 'metal', 'country', 'soul',
];

const TOTAL_STEPS = 4;

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
  // One question per screen: decades, genres, then artists. The stages
  // share this component so picks survive Back.
  const [stage, setStage] = useState<'decades' | 'genres' | 'artists'>('decades');
  // Eleven common genres show by default; "More" unfolds the rest in place.
  const [allGenresOpen, setAllGenresOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Starter artists on the artists stage: from the picked decades and genres
  // at first, then "similar to" the artists picked so far.
  const [suggestions, setSuggestions] = useState<ArtistSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const suggestAbort = useRef<AbortController | null>(null);

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

  // The input only mounts on the artists stage, so focus after that render.
  // Keyed on the stage, not on artistsOpen: a restored profile leaves the
  // section open already, which used to swallow the focus.
  useEffect(() => {
    if (stage !== 'artists' || !focusSearchOnOpen.current) return;
    focusSearchOnOpen.current = false;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [stage]);

  // Refresh suggestions whenever the inputs change while on the artists
  // stage. Debounced so adding two artists in a row makes one request.
  const artistKey = selectedArtists.map((a) => a.id).join(',');
  useEffect(() => {
    if (stage !== 'artists') return;
    const timer = setTimeout(() => {
      suggestAbort.current?.abort();
      const controller = new AbortController();
      suggestAbort.current = controller;
      setSuggesting(true);
      suggestArtists(
        { genres: selectedGenres, eras: selectedEras, artists: selectedArtists.map((a) => a.name) },
        { signal: controller.signal }
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          setSuggestions(result);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.warn('Artist suggestions failed:', err);
          setSuggestions(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSuggesting(false);
        });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, artistKey, selectedGenres.join(','), selectedEras.join(',')]);

  useEffect(() => () => suggestAbort.current?.abort(), []);

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

  // The footer names the picks ("Rock · 80s · Fleetwood Mac") so the user can
  // check them without scrolling back up.
  const summaryNames = [
    ...selectedGenres.map(formatGenre),
    ...[...selectedEras].sort(),
    ...selectedArtists.map((a) => a.name),
  ];
  const summary =
    summaryNames.length === 0
      ? null
      : summaryNames.length <= SUMMARY_NAMES
        ? summaryNames.join(' · ')
        : `${summaryNames.slice(0, SUMMARY_NAMES).join(' · ')} +${summaryNames.length - SUMMARY_NAMES}`;

  const erasFull = selectedEras.length >= MAX_TASTE_ERAS;
  const genresFull = selectedGenres.length >= MAX_TASTE_GENRES;

  const renderGenreChip = (genre: string) => {
    const selected = selectedGenres.includes(genre);
    return (
      <Chip
        key={genre}
        label={formatGenre(genre)}
        selected={selected}
        dimmed={genresFull}
        onPress={() => toggleGenre(genre)}
        accessibilityLabel={`${formatGenre(genre)}, genre`}
      />
    );
  };

  const selectedArtistChips = selectedArtists.length > 0 && (
    <View style={styles.chipWrap}>
      {selectedArtists.map((artist) => (
        <Chip
          key={artist.id}
          label={artist.name}
          selected
          onPress={() => removeArtist(artist.id)}
          accessibilityLabel={`${artist.name}, picked`}
          accessibilityHint="Removes this artist"
          leading={<ArtistAvatar uri={artist.image} size={24} />}
          trailing={<MaterialCommunityIcons name="close" size={16} color={OB.text} />}
        />
      ))}
    </View>
  );

  // Which genres are on screen: the featured eleven plus anything already
  // picked or suggested by a chosen artist, or everything once More is open.
  const visibleGenres = allGenresOpen
    ? uniqueStrings([...artistGenres, ...moreGenres])
    : uniqueStrings([...selectedGenres, ...artistGenres.slice(0, 3), ...FEATURED_GENRES]);
  const hiddenGenreCount = GENRE_OPTIONS.filter((g) => !visibleGenres.includes(g)).length;

  const goToGenres = () => {
    if (saving) return;
    triggerHaptic('light');
    setStage('genres');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const backToDecades = () => {
    if (saving) return;
    Keyboard.dismiss();
    setStage('decades');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const goToArtists = () => {
    if (saving) return;
    triggerHaptic('light');
    // The search is the whole screen here, so it opens with the keyboard up.
    focusSearchOnOpen.current = true;
    setArtistsOpen(true);
    setStage('artists');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const backToGenres = () => {
    if (saving) return;
    Keyboard.dismiss();
    setStage('genres');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  // Continue on the last stage with nothing picked is the same as Skip: no
  // profile to save, straight on to the photo.
  const finish = () => {
    if (canSave) handleSave();
    else handleSkip();
  };

  const eraSummary = selectedEras.length > 0 ? [...selectedEras].sort().join(' · ') : null;
  const stageIndex = stage === 'decades' ? 1 : stage === 'genres' ? 2 : 3;
  const editing = returnTo === 'back';

  // Suggestions minus what is already picked, and where they came from.
  const visibleSuggestions = (suggestions?.artists ?? []).filter((a) => !isArtistSelected(a.id));
  const suggestionBasis =
    suggestions?.basis === 'artists' && selectedArtists.length > 0
      ? `Because you picked ${selectedArtists.map((a) => a.name).slice(0, 2).join(' and ')}`
      : selectedGenres.length > 0 || selectedEras.length > 0
        ? 'From your decades and genres'
        : 'Popular right now';

  const artistsStage = (
    <View style={styles.artists}>
      {selectedArtistChips}

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

      {trimmedQuery.length < SEARCH_MIN_CHARS && !searchError && (
        visibleSuggestions.length > 0 ? (
          <View style={styles.suggest}>
            <View style={styles.suggestHeader}>
              <Text style={styles.suggestTitle}>Suggested for you</Text>
              {suggesting ? <ActivityIndicator size="small" color={OB.textFaint} /> : null}
            </View>
            <Text style={styles.suggestCaption}>{suggestionBasis}</Text>
            <View style={styles.resultsList}>
              {visibleSuggestions.map((artist) => (
                <TouchableOpacity
                  key={artist.id}
                  style={styles.resultRow}
                  onPress={() => toggleArtist(artist)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${artist.name}`}
                >
                  <ArtistAvatar uri={artist.image} size={44} />
                  <View style={styles.resultText}>
                    <Text style={styles.resultName} numberOfLines={1}>{artist.name}</Text>
                    {artist.genres.length > 0 && (
                      <Text style={styles.resultGenres} numberOfLines={1}>
                        {artist.genres.slice(0, 2).map(formatGenre).join(' · ')}
                      </Text>
                    )}
                  </View>
                  <View style={styles.addBtn}>
                    <Text style={styles.addBtnText}>Add</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : suggesting ? (
          <View style={styles.suggestHeader}>
            <Text style={styles.statusText}>Finding artists you might like</Text>
            <ActivityIndicator size="small" color={OB.textFaint} />
          </View>
        ) : showSearchHint ? (
          <Text style={styles.statusText}>Type a name to search Spotify's catalog.</Text>
        ) : null
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
                      {artist.genres.slice(0, 2).map(formatGenre).join(' · ')}
                    </Text>
                  )}
                </View>
                <View style={[styles.addBtn, selected && styles.addBtnOn]}>
                  <Text style={styles.addBtnText}>{selected ? 'Added' : 'Add'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <OnboardingHeader
            step={editing ? undefined : stageIndex}
            total={editing ? undefined : TOTAL_STEPS}
            onBack={stage === 'genres' ? backToDecades : stage === 'artists' ? backToGenres : editing ? handleSkip : undefined}
            onSkip={editing ? undefined : handleSkip}
          />

          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // The dial owns drags on the decades stage; the screen fits
            // without scrolling there, and a scroll view would steal any
            // drag with a vertical component.
            scrollEnabled={stage !== 'decades'}
          >
            {stage === 'decades' ? (
              <>
                <OnboardingIntro
                  eyebrow={editing ? undefined : `Step ${stageIndex} of ${TOTAL_STEPS}`}
                  title="Which decades?"
                  subtitle="Up to three. We pick songs from those years."
                />
                <DecadeDial value={selectedEras} max={MAX_TASTE_ERAS} onChange={setSelectedEras} />
              </>
            ) : stage === 'artists' ? (
              <>
                <OnboardingIntro
                  eyebrow={editing ? undefined : `Step ${stageIndex} of ${TOTAL_STEPS}`}
                  title="Any favourite artists?"
                  subtitle="Optional. Up to three, from Spotify's catalog."
                />
                {artistsStage}
              </>
            ) : (
              <>
                <OnboardingIntro
                  eyebrow={editing ? undefined : `Step ${stageIndex} of ${TOTAL_STEPS}`}
                  title="Which genres?"
                  subtitle="Up to three."
                />
                {limitHint === 'genres' && (
                  <Text style={[styles.limitHint, styles.limitHintInline]}>
                    That's {MAX_TASTE_GENRES} already. Remove one to swap it out.
                  </Text>
                )}
                <View style={styles.grid}>
                  {visibleGenres.map((genre) => (
                    <Chip
                      key={genre}
                      size="grid"
                      label={formatGenre(genre)}
                      selected={selectedGenres.includes(genre)}
                      dimmed={genresFull}
                      onPress={() => toggleGenre(genre)}
                      accessibilityLabel={`${formatGenre(genre)}, genre`}
                    />
                  ))}
                  {!allGenresOpen && hiddenGenreCount > 0 ? (
                    <Chip
                      size="grid"
                      ghost
                      label="More"
                      selected={false}
                      onPress={() => { triggerHaptic('light'); setAllGenresOpen(true); }}
                      accessibilityLabel={`More genres, ${hiddenGenreCount} hidden`}
                    />
                  ) : null}
                </View>
              </>
            )}
          </ScrollView>

          {stage === 'decades' ? (
            <OnboardingFooter
              summary={eraSummary ?? 'Pick up to three, or continue'}
              ctaLabel="Continue"
              onPress={goToGenres}
              bottomInset={insets.bottom}
            />
          ) : stage === 'genres' ? (
            <OnboardingFooter
              summary={selectedGenres.length > 0 ? selectedGenres.map(formatGenre).join(' · ') : 'Pick up to three, or continue'}
              ctaLabel="Continue"
              onPress={goToArtists}
              bottomInset={insets.bottom}
            />
          ) : (
            <OnboardingFooter
              summary={selectedArtists.length > 0 ? selectedArtists.map((a) => a.name).join(' · ') : 'Add up to three, or continue'}
              ctaLabel={editing ? 'Save' : 'Continue'}
              onPress={finish}
              loading={saving}
              bottomInset={insets.bottom}
            />
          )}
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
    paddingHorizontal: OB.margin,
    paddingTop: Spacing.md,
    gap: Spacing.lg,
  },
  section: { gap: LABEL_GAP },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: OB.margin,
    marginTop: 18,
  },
  artists: { paddingHorizontal: OB.margin, marginTop: Spacing.md, gap: LABEL_GAP },
  quietLink: { minHeight: OB.hit, justifyContent: 'center' },
  quietLinkText: { color: OB.textDim, fontSize: OB.body },
  quietLinkAction: { color: OB.purpleText, fontWeight: '700' },
  limitHintInline: { paddingHorizontal: OB.margin, marginTop: 10 },

  groupLabel: { color: OB.textFaint, fontSize: OB.caption, fontWeight: '600' },

  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },

  avatarImage: { backgroundColor: OB.surface },
  avatarPlaceholder: {
    backgroundColor: PRIMARY_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  addArtistsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 4,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: OB.surface,
    borderWidth: 1,
    borderColor: OB.border,
  },
  addArtistsIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(139,92,246,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addArtistsText: { flex: 1, gap: 2 },
  addArtistsTitle: { color: OB.text, fontSize: OB.body, fontWeight: '600' },
  addArtistsCaption: { color: OB.textDim, fontSize: OB.caption },

  suggest: { gap: 6 },
  suggestHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggestTitle: { color: OB.text, fontSize: OB.section, fontWeight: '700' },
  suggestCaption: { color: OB.textFaint, fontSize: OB.caption, marginBottom: 4 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: 12,
    backgroundColor: OB.surface,
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
    gap: 2,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 4,
    minHeight: 56,
    paddingVertical: Spacing.xs,
  },
  resultRowSelected: {},
  resultText: { flex: 1 },
  resultName: { color: OB.text, fontSize: OB.body, fontWeight: '600' },
  resultGenres: { color: OB.textFaint, fontSize: 12, marginTop: 2 },
  addBtn: {
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnOn: { backgroundColor: OB.primary, borderColor: OB.primary },
  addBtnText: { color: OB.text, fontSize: OB.caption, fontWeight: '700' },
});

export default TastePickerScreen;
