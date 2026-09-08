import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Image,
  TouchableOpacity,
  Alert,
  Animated,
  Dimensions,
  Modal,
  ActivityIndicator,
  ScrollView,
  Text,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getImageSignedUrl, supabase } from '../../../lib/supabase';
import { Spacing } from '../../../lib/designSystem';
import { OB, OnboardingFooter } from '../../../lib/components/OnboardingChrome';
import { triggerHaptic } from '../../../lib/utils/haptics';
import { maybeRequestReview } from '../../../lib/reviewPrompt';
import { trackEvent } from '../../../lib/posthog';
import { subscribeToCredits } from '../../../lib/creditState';
import OutOfMatchesCard from '../../../lib/components/OutOfMatchesCard';
import { isGuestHistoryId, removeGuestHistoryItem } from '../../../lib/guestHistory';
import { TrackPreviewProvider } from '../../../lib/trackPreview';
import { TrackPreviewButton } from '../../../lib/components/TrackPreviewButton';
import { ExpandableText } from '../../../lib/components/ExpandableText';

/**
 * The match. Photo on top, the first song under it with its reason, play,
 * two more songs as rows, and on the first result one Continue button.
 *
 * The previous version painted the song over the photo behind a gradient,
 * floated a pulsing "Start Exploring" pill over the image, labelled both
 * sections in uppercase, and carried a thousand lines of a retired
 * "It's a match" animation. See the "TuneMatch first run" design page,
 * section "The result", for the removal test behind this layout.
 */

// "Swallowed - Remastered" -> "Swallowed". Spotify's catalog title carries
// edition suffixes the model was told not to produce; strip them for display
// only, the search and the links still use the catalog title.
const displayTitle = (title: string) =>
  title.replace(/\s+[-(]\s*(remaster(ed)?|\d{4} remaster(ed)?|radio edit|single version|deluxe|live|mono|stereo)[^)]*\)?\s*$/i, '').trim() || title;

type Song = {
  title: string;
  artist: string;
  reason: string;
  /** 'artist' means the reason is artist-level, because the exact track did not resolve. */
  match_kind?: 'exact' | 'artist';
  spotify_url?: string;
  album_cover?: string;
  preview_url?: string | null;
};

type ResultsParams = {
  image: string; // file path or signed URL
  songs: Song[];
  historyItemId?: string;
  imagePath?: string; // storage path for refreshing signed URLs
  fromOnboarding?: boolean;
  fromFreshMatch?: boolean; // live new match, not a history re-view
};

type TabParamList = {
  Home: undefined;
  History: undefined;
  Profile: undefined;
};

type HistoryStackParamList = {
  History: undefined;
  HistoryResults: ResultsParams;
};

type ResultsNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<any>,
  CompositeNavigationProp<
    BottomTabNavigationProp<TabParamList>,
    NativeStackNavigationProp<HistoryStackParamList>
  >
>;

const ResultsScreen = () => {
  const route = useRoute();
  const navigation = useNavigation<ResultsNavigationProp>();
  const insets = useSafeAreaInsets();
  // The balance after this scan, straight from the response the server sent.
  // Only a FRESH match can be somebody's last one; re-reading an old match
  // from the Vault must never turn into a sales pitch.
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const [creditsArePro, setCreditsArePro] = useState(false);
  const [nextFreeAt, setNextFreeAt] = useState<Date | null>(null);
  useEffect(() => subscribeToCredits((state) => {
    setCreditsLeft(state.source === 'server' ? state.balance : null);
    setCreditsArePro(state.isPro);
    setNextFreeAt(state.nextFreeAt);
  }), []);

  const { image, songs = [], historyItemId, imagePath, fromOnboarding, fromFreshMatch } =
    (route.params || {}) as ResultsParams;

  const [imageUrl, setImageUrl] = useState<string>(image);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [modalImageSize, setModalImageSize] = useState<{ width: number; height: number } | null>(null);

  // One entrance: the content fades and rises once. Nothing loops.
  const enter = useRef(new Animated.Value(0)).current;

  const storageImagePath = imagePath || (image && !image.startsWith('http') ? image : undefined);
  const main = songs[0];
  const others = songs.slice(1, 3);

  // After a genuine fresh match, give the user a moment to see the result,
  // then (maybe) surface the native review sheet. Gated once-ever inside
  // maybeRequestReview(); history re-views never pass fromFreshMatch.
  useEffect(() => {
    if (!fromFreshMatch) return;
    const t = setTimeout(() => {
      maybeRequestReview();
    }, 3500);
    return () => clearTimeout(t);
  }, []);

  // The payoff screen. Fresh against history separates activation from
  // re-engagement, and the title says which songs people actually got.
  useEffect(() => {
    trackEvent('results_viewed', {
      source: fromFreshMatch ? 'fresh' : 'history',
      from_onboarding: !!fromOnboarding,
      song_count: songs.length,
      title: main?.title,
      artist: main?.artist,
      // How the hero resolved, and how many of the three are substitutions.
      match_kind: main?.match_kind,
      fallback_count: songs.slice(0, 3).filter((s) => s.match_kind === 'artist').length,
    });
  }, []);

  // The first result is a one-way step: hide the tab bar so Continue is the
  // only way forward. Restore on BLUR, not unmount: Continue can end in
  // `navigate('History', { screen: 'History' })` within this same stack, so
  // the screen does not reliably unmount, and an unmount-only cleanup left
  // the History list with no tab bar and no way out.
  // Hidden for the onboarding result by MainTabs (it reads fromOnboarding off
  // this route's params). No setOptions here for the reason given there.

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [enter]);

  useEffect(() => {
    let isMounted = true;
    const loadImage = async () => {
      if (storageImagePath) {
        try {
          const signedUrl = await getImageSignedUrl(storageImagePath);
          if (signedUrl && isMounted) setImageUrl(signedUrl);
        } catch (error) {
          console.error('Error fetching signed image URL:', error);
        }
      } else {
        setImageUrl(image);
      }
    };
    loadImage();
    return () => {
      isMounted = false;
    };
  }, [image, storageImagePath]);

  useEffect(() => {
    if (!imageUrl) {
      setModalImageSize(null);
      return;
    }
    const window = Dimensions.get('window');
    const maxWidth = Math.max(window.width - Spacing.lg * 2, 200);
    const maxHeight = Math.max(window.height - (insets.top + insets.bottom + 120), 200);
    Image.getSize(
      imageUrl,
      (w, h) => {
        let displayWidth = maxWidth;
        let displayHeight = (h / w) * displayWidth;
        if (displayHeight > maxHeight) {
          displayHeight = maxHeight;
          displayWidth = (w / h) * displayHeight;
        }
        setModalImageSize({ width: displayWidth, height: displayHeight });
      },
      (error) => {
        console.error('Error getting image size:', error);
        setModalImageSize({ width: maxWidth, height: maxHeight });
      }
    );
  }, [imageUrl, insets.bottom, insets.top]);

  const handleBackPress = () => {
    triggerHaptic('light');
    if (fromOnboarding) {
      (navigation as any).reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      return;
    }
    if (route.name === 'HistoryResults') {
      // Always back to the History list, never to Analyzing.
      navigation.navigate('History', { screen: 'History' });
    } else {
      navigation.goBack();
    }
  };

  const handleContinue = async () => {
    trackEvent('results_continue_tapped', { from_onboarding: !!fromOnboarding });
    // No paywall here. Someone who has just had their first match still has
    // credits left, so the pitch lands before they have any reason to buy and
    // reads as a toll booth on the one screen that was supposed to be the
    // payoff. The paywall stays reachable from the Dashboard banner, the
    // credits pill and the out-of-credits wall, which is where the want
    // actually appears.

    // Discover, not the Vault: they still have credits after the first match,
    // so the useful next step is matching another photo. The Vault only shows
    // them the one they already have.
    navigation.navigate('Home', { screen: 'Dashboard' });
  };

  const handleImagePress = useCallback(() => {
    setImageModalVisible(true);
    if (storageImagePath) {
      getImageSignedUrl(storageImagePath)
        .then((refreshedUrl) => {
          if (refreshedUrl) setImageUrl(refreshedUrl);
        })
        .catch((error) => {
          console.error('Error refreshing image URL:', error);
        });
    }
  }, [storageImagePath]);

  const closeImageModal = () => setImageModalVisible(false);

  const handleDeletePress = () => {
    if (!historyItemId) return;

    Alert.alert('Delete this match?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            // Guest items live only in local storage: no row, no session.
            if (isGuestHistoryId(historyItemId)) {
              await removeGuestHistoryItem(historyItemId!);
              trackEvent('history_item_deleted', { storage: 'local' });
              navigation.goBack();
              return;
            }

            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
              Alert.alert('Error', 'You must be logged in to delete items.');
              return;
            }

            const { data: existingItem, error: fetchError } = await supabase
              .from('history')
              .select('id, user_id')
              .eq('id', historyItemId)
              .single();

            if (fetchError || !existingItem) {
              Alert.alert('Error', 'Item not found.');
              return;
            }
            if (existingItem.user_id !== session.user.id) {
              Alert.alert('Error', 'You do not have permission to delete this item.');
              return;
            }

            const { error, count } = await supabase
              .from('history')
              .delete({ count: 'exact' })
              .eq('id', historyItemId)
              .eq('user_id', session.user.id);

            if (error) {
              console.error('Error deleting history item:', error);
              Alert.alert('Error', `Failed to delete item: ${error.message}`);
              return;
            }
            if (count !== null && count === 0) {
              Alert.alert('Error', 'Failed to delete item. This may be a permissions issue.');
              return;
            }

            trackEvent('history_item_deleted', { storage: 'remote' });
            // Small delay so the list refresh sees the deletion.
            await new Promise((resolve) => setTimeout(resolve, 300));
            navigation.goBack();
          } catch (err) {
            console.error('Error deleting history item:', err);
            Alert.alert('Error', 'An error occurred while deleting the item.');
          }
        },
      },
    ]);
  };

  const enterStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };

  return (
    <TrackPreviewProvider>
      <View style={styles.container}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scroll, !fromOnboarding && styles.scrollAboveTabBar]}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
        >
          {/* The photo, edge to edge, square. Tap to see it in full. */}
          <TouchableOpacity
            onPress={handleImagePress}
            activeOpacity={0.96}
            style={styles.photoWrap}
            accessibilityRole="imagebutton"
            accessibilityLabel="Your photo. Opens full screen."
          >
            {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.photo} /> : null}
            {/* The photo melts into the page instead of ending on a hard
                edge. Purely decorative, and it never covers the song. */}
            <LinearGradient
              colors={['transparent', OB.bg + 'B3', OB.bg]}
              locations={[0, 0.6, 1]}
              style={styles.photoFade}
              pointerEvents="none"
            />
          </TouchableOpacity>

          <Animated.View style={[styles.content, enterStyle]}>
            {main ? (
              <>
                <Text style={styles.title} accessibilityRole="header">
                  {displayTitle(main.title || 'Unknown title')}
                </Text>
                <Text style={styles.artist} numberOfLines={1}>
                  {main.artist || 'Unknown artist'}
                </Text>
                {!!main.reason && (
                  <View style={styles.reason}>
                    <ExpandableText
                      text={main.reason}
                      collapsedLines={2}
                      style={styles.reasonText}
                      toggleColor={OB.text}
                    />
                  </View>
                )}
                <View style={styles.play}>
                  <TrackPreviewButton song={main} variant="quiet" />
                </View>
              </>
            ) : null}

            {others.length > 0 ? (
              <View style={styles.rows}>
                {others.map((song, idx) => (
                  <View key={`${song.title}-${idx}`} style={styles.row}>
                    <View style={styles.rowMain}>
                      {song.album_cover ? (
                        <Image source={{ uri: song.album_cover }} style={styles.art} />
                      ) : (
                        <View style={[styles.art, styles.artFallback]}>
                          <MaterialCommunityIcons name="music-note" size={20} color={OB.textFaint} />
                        </View>
                      )}
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {displayTitle(song.title || 'Unknown title')}
                        </Text>
                        <Text style={styles.rowArtist} numberOfLines={1}>
                          {song.artist || 'Unknown artist'}
                        </Text>
                      </View>
                      <TrackPreviewButton song={song} variant="row" />
                    </View>
                    {/* Songs 2 and 3 lost their description in the results
                        redesign and people noticed. Same component and same
                        two-line clamp as the hero, so the two behave alike. */}
                    {!!song.reason && (
                      <View style={styles.rowReason}>
                        <ExpandableText
                          text={song.reason}
                          collapsedLines={2}
                          style={styles.rowReasonText}
                          toggleColor={OB.textDim}
                        />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ) : null}
            {/* The pitch goes here, under a result they are still looking at,
                rather than as a dialog when they try to navigate away. Tapping
                Vault after a match is somebody going to look at the thing they
                just made; interrupting that is the worst moment to sell. */}
            {fromFreshMatch && !creditsArePro && creditsLeft === 0 ? (
              <OutOfMatchesCard
                variant="results"
                nextFreeAt={nextFreeAt}
                style={{ marginTop: 22 }}
                onBuy={() => {
                  trackEvent('paywall_cta_tapped', { source: 'results_last_match' });
                  (navigation as any).navigate('Payment');
                }}
              />
            ) : null}
          </Animated.View>
        </ScrollView>

        {/* Back and delete sit on the photo, only on history views. The first
            result has one way forward: the footer. */}
        {!fromOnboarding ? (
          <View style={[styles.photoNav, { top: insets.top + 6 }]} pointerEvents="box-none">
            <TouchableOpacity
              onPress={handleBackPress}
              style={styles.navBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <MaterialCommunityIcons name="chevron-left" size={26} color={OB.text} />
            </TouchableOpacity>
            {historyItemId ? (
              <TouchableOpacity
                onPress={handleDeletePress}
                style={styles.navBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Delete this match"
              >
                <MaterialCommunityIcons name="trash-can-outline" size={22} color={OB.text} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {fromOnboarding ? (
          <OnboardingFooter ctaLabel="Continue" onPress={handleContinue} bottomInset={insets.bottom} />
        ) : (
          <View style={{ height: insets.bottom }} />
        )}
      </View>

      <Modal visible={imageModalVisible} transparent animationType="fade" onRequestClose={closeImageModal}>
        <View style={styles.modalContainer}>
          <TouchableOpacity style={styles.modalBackground} onPress={closeImageModal} activeOpacity={1}>
            <SafeAreaView style={styles.modalContent}>
              <TouchableOpacity
                style={[styles.closeButton, { top: insets.top + 10 }]}
                onPress={closeImageModal}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <MaterialCommunityIcons name="close" size={28} color={OB.text} />
              </TouchableOpacity>
              <View style={styles.fullImageContainer}>
                {imageUrl && modalImageSize ? (
                  <Image source={{ uri: imageUrl }} style={[styles.fullImage, modalImageSize]} resizeMode="contain" />
                ) : (
                  <ActivityIndicator size="large" color={OB.primary} />
                )}
              </View>
              <Text style={styles.imageInfoText}>Tap anywhere to close</Text>
            </SafeAreaView>
          </TouchableOpacity>
        </View>
      </Modal>
    </TrackPreviewProvider>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: OB.bg },
  flex: { flex: 1 },
  scroll: { paddingBottom: Spacing.lg },
  // History views keep the floating tab bar; the last row must clear it.
  scrollAboveTabBar: { paddingBottom: 120 },
  photoWrap: { width: '100%', aspectRatio: 1, backgroundColor: OB.surface },
  photoFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140 },
  photo: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoNav: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: OB.margin, paddingTop: 14 },
  title: {
    color: OB.text,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  artist: { color: OB.textDim, fontSize: OB.body, marginTop: 2 },
  reason: { marginTop: 10 },
  reasonText: { color: OB.textDim, fontSize: 14, lineHeight: 20 },
  play: { marginTop: 12 },
  rows: {
    // Tightened from 22 with the paddings below, so the third song breaks the
    // fold and reads as "there is more" rather than ending the page.
    marginTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OB.border,
  },
  row: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  // 44pt art plus the 12pt gap, so the text hangs under the title rather than
  // under the artwork and the row still reads as one block.
  rowReason: { marginTop: 6, marginLeft: 56 },
  // textDim, not textFaint: textFaint is 4.48:1 on this background and misses
  // AA for body text. Size carries the hierarchy against the 15pt title.
  rowReasonText: { color: OB.textDim, fontSize: OB.caption, lineHeight: 18 },
  art: { width: 44, height: 44, borderRadius: 8, backgroundColor: OB.surface },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { color: OB.text, fontSize: OB.body, fontWeight: '600' },
  rowArtist: { color: OB.textFaint, fontSize: OB.caption, marginTop: 1 },

  modalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  modalBackground: { flex: 1 },
  modalContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  fullImageContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  fullImage: { borderRadius: 12 },
  imageInfoText: { color: OB.textFaint, fontSize: OB.caption, paddingBottom: Spacing.lg },
});

export default ResultsScreen;
