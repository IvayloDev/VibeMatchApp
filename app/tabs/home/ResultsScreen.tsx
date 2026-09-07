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
import * as SecureStore from 'expo-secure-store';
import { getImageSignedUrl, supabase } from '../../../lib/supabase';
import { Spacing } from '../../../lib/designSystem';
import { OB, OnboardingFooter } from '../../../lib/components/OnboardingChrome';
import { triggerHaptic } from '../../../lib/utils/haptics';
import { maybeRequestReview } from '../../../lib/reviewPrompt';
import { hasProEntitlement } from '../../../lib/revenuecat';
import { isGuestHistoryId, removeGuestHistoryItem } from '../../../lib/guestHistory';
import { trackEvent } from '../../../lib/posthog';
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

// Once-ever flag for the post-first-scan paywall pitch (device-scoped).
const RESULTS_PAYWALL_SHOWN_KEY = 'tunematch_results_paywall_shown';

// "Swallowed - Remastered" -> "Swallowed". Spotify's catalog title carries
// edition suffixes the model was told not to produce; strip them for display
// only, the search and the links still use the catalog title.
const displayTitle = (title: string) =>
  title.replace(/\s+[-(]\s*(remaster(ed)?|\d{4} remaster(ed)?|radio edit|single version|deluxe|live|mono|stereo)[^)]*\)?\s*$/i, '').trim() || title;

type Song = {
  title: string;
  artist: string;
  reason: string;
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

  // The first result is a one-way step: hide the tab bar so Continue is the
  // only way forward. Restore on BLUR, not unmount: Continue can end in
  // `navigate('History', { screen: 'History' })` within this same stack, so
  // the screen does not reliably unmount, and an unmount-only cleanup left
  // the History list with no tab bar and no way out.
  useFocusEffect(
    useCallback(() => {
      if (!fromOnboarding) return;
      const tabNavigation = navigation.getParent();
      tabNavigation?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => {
        tabNavigation?.setOptions({ tabBarStyle: undefined });
      };
    }, [fromOnboarding, navigation])
  );

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
    // Show the subscription paywall exactly once per device, at the peak of
    // the first match. Every later tap goes to the Vault; the paywall stays
    // reachable from the Dashboard banner, the credits pill and the
    // out-of-credits gate, so this moment is a single pitch, not a toll
    // booth. Subscribers skip it.
    let showPaywall = false;
    try {
      const alreadyShown = await SecureStore.getItemAsync(RESULTS_PAYWALL_SHOWN_KEY);
      if (!alreadyShown && !(await hasProEntitlement())) {
        await SecureStore.setItemAsync(RESULTS_PAYWALL_SHOWN_KEY, 'true');
        showPaywall = true;
      }
    } catch {
      showPaywall = false;
    }

    if (showPaywall) {
      trackEvent('paywall_cta_tapped', { source: 'results_explore' });
      navigation.navigate('Payment');
      return;
    }

    // The Vault holds the match they just made, guest or not. Discover would
    // be a 0-credit upload prompt, a dead end.
    navigation.navigate('History', { screen: 'History' });
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
                ))}
              </View>
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
  content: { paddingHorizontal: OB.margin, paddingTop: 18 },
  title: {
    color: OB.text,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  artist: { color: OB.textDim, fontSize: OB.body, marginTop: 2 },
  reason: { marginTop: 12 },
  reasonText: { color: OB.textDim, fontSize: 14, lineHeight: 20 },
  play: { marginTop: 14 },
  rows: {
    marginTop: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OB.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
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
