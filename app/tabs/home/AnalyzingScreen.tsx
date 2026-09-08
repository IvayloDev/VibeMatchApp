import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Animated, Dimensions, Alert, TouchableOpacity, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../../lib/components/BlurViewFallback';
import WallSheet from '../../../lib/components/WallSheet';
import { nextLocalMidnight } from '../../../lib/dailyCredit';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../../lib/AuthContext';
import { requireIdentity } from '../../../lib/identity';
import { getCreditState, applyScanCredits } from '../../../lib/creditState';
import { supabase } from '../../../lib/supabase';
import { Spacing, BorderRadius, Shadows } from '../../../lib/designSystem';
import { triggerHaptic } from '../../../lib/utils/haptics';
import { describeScanFailure, noMatchFailure, networkScanFailure, imagePrepFailure } from '../../../lib/scanErrors';
import { getPreparedImage, peekPreparedImage } from '../../../lib/imagePrep';
import { recordSuccessfulMatch } from '../../../lib/reviewPrompt';
import { ensureNotificationPermission, rescheduleEngagementReminders } from '../../../lib/notifications';
import { trackEvent } from '../../../lib/posthog';
import { addGuestHistoryItem, loadGuestHistory } from '../../../lib/guestHistory';
import { getDeviceId } from '../../../lib/utils/freeCredits';

// How many past guest matches feed the avoid list. The server keeps its own
// per-device record, so this only has to cover the very recent ones.
const GUEST_AVOID_ITEMS = 5;

const { width, height } = Dimensions.get('window');

// Colors from HTML reference
const DesignColors = {
  primary: '#f4258c',
  accentPurple: '#8b5cf6',
  backgroundDark: '#221019',
};

// Tag categories that will cycle - using valid MaterialCommunityIcons names
const TAG_CATEGORIES = [
  { id: 1, label: 'Golden Hour', icon: 'star-outline', active: false },
  { id: 2, label: 'Chill', icon: 'weather-night', active: false },
  { id: 3, label: 'Lo-Fi', icon: 'equalizer', active: false },
  { id: 4, label: 'Electronic', icon: 'radio', active: false },
  { id: 5, label: 'Vintage', icon: 'album', active: false },
  { id: 6, label: 'Energetic', icon: 'flash', active: false },
  { id: 7, label: 'Ambient', icon: 'wave', active: false },
  { id: 8, label: 'Indie', icon: 'guitar-electric', active: false },
  { id: 9, label: 'Pop', icon: 'microphone', active: false },
  { id: 10, label: 'Rock', icon: 'guitar-acoustic', active: false },
];

type AnalyzingParams = { image: string; selectedVibe?: string; userId?: string; fromOnboarding?: boolean };
type RootStackParamList = {
  Results: { image: string; songs: any[]; imagePath?: string };
  Payment: undefined;
};

type TabParamList = {
  Home: undefined;
  History: undefined;
  Profile: undefined;
};

type HistoryStackParamList = {
  History: undefined;
  HistoryResults: { image: string; songs: any[]; historyItemId?: string; imagePath?: string };
};

type AnalyzingNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<RootStackParamList>,
  CompositeNavigationProp<
    BottomTabNavigationProp<TabParamList>,
    NativeStackNavigationProp<HistoryStackParamList>
  >
>;

/**
 * Upload the photo and return the storage path.
 *
 * Guests get `anonymous/<uuid>/<uuid>.jpg`. The random nested uuid matters:
 * `anon` now has INSERT-only on the bucket with no read access, so the path
 * itself is the capability that lets the guest's own thumbnail be signed later
 * (via the sign-image function). The old `anonymous/<ms>.jpg` scheme was
 * guessable and is gone.
 *
 * Only signed-in users get a signed URL here - they own their folder under RLS.
 * Guests hand the path to the server instead and it reads the object for them.
 */
const SCAN_ID_KEY_PREFIX = '@tunematch_scan_id:';

/**
 * One scan id per photo, surviving an unmount.
 *
 * The server charges against this id and replays the same answer for a repeat,
 * so it is the difference between a retry costing nothing and costing a second
 * credit. Minting it in component state would lose it the moment the screen
 * remounts - an Android back press, a backgrounded app, a navigation retry -
 * and the next attempt would look like a brand new scan to the server.
 */
async function scanIdForImage(imageKey: string): Promise<string> {
  const key = `${SCAN_ID_KEY_PREFIX}${imageKey}`;
  try {
    const existing = await AsyncStorage.getItem(key);
    if (existing) return existing;
    const fresh = Crypto.randomUUID().toLowerCase();
    await AsyncStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Without persistence a retry may charge twice. Still better than refusing
    // the scan, and the server's own in-flight guard catches the common case.
    return Crypto.randomUUID().toLowerCase();
  }
}

function buildImagePath(userId?: string): string {
  // Every install has a uid now, anonymous or not, so there is no guest prefix
  // to fall back to. The legacy anonymous/<uuid>/<uuid>.jpg branch below is
  // kept only for the case where an identity genuinely could not be minted,
  // which is a failure path rather than a normal one.
  if (userId) return `${userId}/${Date.now()}.jpg`;
  // Lowercase explicitly: the storage INSERT policy and both edge functions match
  // this path with a strict lowercase-hex pattern, so an uppercase uuid would be
  // rejected at upload. randomUUID is already lowercase per spec; this pins it.
  const seg = () => Crypto.randomUUID().toLowerCase();
  return `anonymous/${seg()}/${seg()}.jpg`;
}

async function uploadImageAndGetSignedUrl(localUri: string, userId?: string) {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const reader = new FileReader();

  return new Promise<{ filePath: string; signedUrl: string | null }>((resolve, reject) => {
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const file = base64.split(',')[1];
        const filePath = buildImagePath(userId);
        const byteArray = Uint8Array.from(atob(file), c => c.charCodeAt(0));

        console.log('📤 [Upload] Attempting to upload file to path:', filePath);
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('images')
          .upload(filePath, byteArray, {
            contentType: 'image/jpeg',
            // Guests must NOT upsert. Upsert makes storage do INSERT ... ON
            // CONFLICT DO UPDATE, which needs an UPDATE policy, and `anon` is
            // deliberately INSERT-only now - it used to hold a blanket UPDATE
            // that let anyone overwrite any user's photo. Guest paths are random
            // uuids, so there is nothing to overwrite anyway. Signed-in users
            // own their folder and keep the original behaviour.
            upsert: !!userId,
          });

        if (uploadError) {
          console.error('❌ [Upload] Upload failed:', uploadError);
          console.error('❌ [Upload] File path:', filePath);
          throw uploadError;
        }

        console.log('✅ [Upload] Upload successful. Data:', uploadData);
        
        // Use the actual path returned from upload (in case it was modified)
        const actualFilePath = uploadData?.path || filePath;

        // Guests have no read policy on the bucket, so there is nothing to sign
        // client-side. The path alone is enough: recommend-songs reads the
        // object server-side, and the results screen shows the local image.
        if (!userId) {
          console.log('✅ [Upload] Guest upload complete, skipping client-side signing');
          resolve({ filePath: actualFilePath, signedUrl: null });
          return;
        }

        console.log('🔗 [Upload] Creating signed URL for path:', actualFilePath);

        const { data, error: signedUrlError } = await supabase.storage
          .from('images')
          .createSignedUrl(actualFilePath, 60 * 60);

        if (signedUrlError) {
          console.error('❌ [Upload] Signed URL creation failed:', signedUrlError);
          console.error('❌ [Upload] Attempted path:', actualFilePath);
          
          if (signedUrlError.message?.includes('JSON Parse error') || signedUrlError.message?.includes('Unexpected character')) {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session) {
              throw new Error('Authentication error. Please sign in again.');
            }
            const { data: retryData, error: retryError } = await supabase.storage
              .from('images')
              .createSignedUrl(actualFilePath, 60 * 60);
            if (retryError) {
              console.error('❌ [Upload] Retry also failed:', retryError);
              throw retryError;
            }
            if (!retryData?.signedUrl) throw new Error('Failed to get signed URL after retry');
            console.log('✅ [Upload] Signed URL created on retry');
            resolve({ filePath: actualFilePath, signedUrl: retryData.signedUrl });
            return;
          }
          throw signedUrlError;
        }

        if (!data || !data.signedUrl) {
          console.error('❌ [Upload] No signed URL data returned');
          throw new Error('No signed URL returned from storage');
        }

        console.log('✅ [Upload] Signed URL created successfully');
        resolve({ filePath: actualFilePath, signedUrl: data.signedUrl });
      } catch (error) {
        console.error('Error in uploadImageAndGetSignedUrl:', error);
        reject(error);
      }
    };
    reader.readAsDataURL(blob);
  });
}

const AnalyzingScreen = () => {
  const navigation = useNavigation<AnalyzingNavigationProp>();
  const route = useRoute();
  const { image, selectedVibe, userId, fromOnboarding } = (route.params || {}) as AnalyzingParams;

  // Never render the raw picked file here. Three <Image> of the same uri are
  // mounted at once on this screen (the blurRadius 80 backdrop, the scanning
  // preview and the blurRadius 18 reveal overlay), and a blur runs over the
  // whole decoded bitmap, so the original would be decoded and blurred at full
  // resolution three times over. The prep is started when the photo is picked
  // and is finished long before this screen mounts, so the seed below is
  // normally a hit; in the rare miss the frames render without the photo
  // rather than with the original.
  const [displayUri, setDisplayUri] = useState<string | null>(() => peekPreparedImage(image));

  useEffect(() => {
    let cancelled = false;
    getPreparedImage(image).then((prepared) => {
      if (!cancelled && prepared) setDisplayUri(prepared);
    });
    return () => {
      cancelled = true;
    };
  }, [image]);

  const [progress, setProgress] = useState(0);
  const [activeTagIndex, setActiveTagIndex] = useState(0);
  // Shuffle tags initially for random selection
  const [tags, setTags] = useState(() => {
    const shuffled = [...TAG_CATEGORIES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 5);
  });
  
  // Track visited tag indices to know when to replace tags
  const visitedTagIndices = useRef<Set<number>>(new Set());
  // Use ref to access latest tags inside interval
  const tagsRef = useRef(tags);
  
  // Animation values
  const scanningLineAnim = useRef(new Animated.Value(0)).current;
  const cornerPulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseDotAnim = useRef(new Animated.Value(1)).current;

  // "Match found" reveal
  const [matchSong, setMatchSong] = useState<any>(null);
  // Out-of-matches wall + what it needs to know.
  const [showWall, setShowWall] = useState(false);
  const [nextFreeAt, setNextFreeAt] = useState<Date>(() => nextLocalMidnight());
  // The wall's register upsell asks "has an account", which the route param
  // never answered correctly in either direction: it was seeded from a
  // possibly-stale userId, and every guest now has one. Ask AuthContext.
  const { isRegistered } = useAuth();
  // Bumped to re-run the blocked scan (after a pack bought from the wall, or
  // when the user comes back from the paywall).
  const [scanAttempt, setScanAttempt] = useState(0);
  const wentToPaywall = useRef(false);
  const revealBackdrop = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.4)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslate = useRef(new Animated.Value(24)).current;

  useFocusEffect(
    React.useCallback(() => {
      const parent = navigation.getParent();
      if (parent) {
        parent.setOptions({ tabBarStyle: { display: 'none' } });
      }
      return () => {
        if (parent) {
          parent.setOptions({ tabBarStyle: { display: 'flex' } });
        }
      };
    }, [navigation])
  );

  // Back from the paywall the wall sent them to: re-run the gate. A new Pro
  // or a pack bought there scans right away; otherwise the wall returns.
  useFocusEffect(
    React.useCallback(() => {
      if (wentToPaywall.current) {
        wentToPaywall.current = false;
        setScanAttempt((n) => n + 1);
      }
    }, [])
  );

  // Same "leave the blocked scan" behavior the native alert used.
  const leaveBlockedScan = () => {
    if (fromOnboarding) {
      (navigation as any).reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } else {
      (navigation as any).navigate('Dashboard');
    }
  };

  // Update ref when tags change
  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    // Scanning line animation - ping pong (up and down continuously)
    const scanningLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanningLineAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(scanningLineAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    );
    scanningLoop.start();

    // Corner boxes pulse animation
    const cornerPulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(cornerPulseAnim, {
          toValue: 1.2,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(cornerPulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    cornerPulseLoop.start();

    // Pulse dot animation
    const pulseDotLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseDotAnim, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseDotAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulseDotLoop.start();

    // Tag cycling animation - randomly select tags and replace after all are visited
    const tagInterval = setInterval(() => {
      setActiveTagIndex((prev) => {
        const currentTags = tagsRef.current;
        
        // Mark current tag as visited
        visitedTagIndices.current.add(prev);
        
        // If all tags have been visited, replace them with new ones
        if (visitedTagIndices.current.size >= currentTags.length) {
          visitedTagIndices.current.clear();
          
          // Get currently visible tag IDs to avoid duplicates
          const currentTagIds = new Set(currentTags.map(t => t.id));
          
          // Get available tags (not currently visible)
          const availableTags = TAG_CATEGORIES.filter(t => !currentTagIds.has(t.id));
          
          // Shuffle and pick new tags
          const shuffled = [...availableTags].sort(() => Math.random() - 0.5);
          
          // If we don't have enough new tags, use all categories shuffled
          const newTags = shuffled.length >= 5 
            ? shuffled.slice(0, 5)
            : [...TAG_CATEGORIES].sort(() => Math.random() - 0.5).slice(0, 5);
          
          setTags(newTags);
          const newIndex = Math.floor(Math.random() * newTags.length);
          visitedTagIndices.current.add(newIndex);
          return newIndex;
        }
        
        // Pick a random index from unvisited tags, or random if all visited (fallback)
        const unvisitedIndices = Array.from({ length: currentTags.length }, (_, i) => i)
          .filter(i => !visitedTagIndices.current.has(i));
        
        let newIndex;
        if (unvisitedIndices.length > 0) {
          // Pick from unvisited tags
          newIndex = unvisitedIndices[Math.floor(Math.random() * unvisitedIndices.length)];
        } else {
          // Fallback: pick random, avoiding current if possible
          do {
            newIndex = Math.floor(Math.random() * currentTags.length);
          } while (newIndex === prev && currentTags.length > 1);
        }
        
        return newIndex;
      });
    }, 1200);

    // Both the `Analyzing` and `OnboardingAnalyzing` routes render this screen.
    // The callers used to own the credit check and only VibeSelectionScreen did
    // it, so the onboarding path handed out free scans. The gate lives here now,
    // at the one point both routes pass through, and before any upload or model
    // call so a blocked scan costs nothing.
    const leaveOnBlocked = fromOnboarding
      ? () => (navigation as any).reset({ index: 0, routes: [{ name: 'MainTabs' }] })
      : () => (navigation as any).navigate('Dashboard');

    const analyzePhoto = async () => {
      let uploadedFilePath: string | null = null;
      const scanStartTime = Date.now();

      // The resize has been running in the background since the photo was
      // picked; this is the first point the flow actually needs the bytes.
      // Waiting here instead of on Discover means any leftover wait happens
      // under the scanning animation, which already looks like work.
      //
      // No falling back to the original if it failed: the path (.jpg), the
      // upload contentType (image/jpeg), the guest storage policy and both edge
      // functions are all hardcoded for JPEG, so raw HEIC bytes would be stored
      // mislabelled and come back as an unexplained failure much later.
      const prepWaitStart = Date.now();
      const preparedUri = await getPreparedImage(image);
      const prepWaitMs = Date.now() - prepWaitStart;
      if (!preparedUri) {
        const prepFailure = imagePrepFailure();
        trackEvent('scan_failed', {
          reason: prepFailure.reason,
          vibe: selectedVibe,
          from_onboarding: !!fromOnboarding,
          duration_ms: Date.now() - scanStartTime,
        });
        // Before the gate, so nothing has been read, charged or counted.
        Alert.alert(prepFailure.title, prepFailure.message, [
          { text: 'OK', onPress: leaveOnBlocked },
        ]);
        return;
      }

      // The gate is advisory now. The server decides whether this scan can
      // be paid for, because it is the only party that cannot be lied to, and
      // it refuses with 402 BEFORE spending anything on the model. Blocking
      // here as well would mean two sources of truth, and the client's copy is
      // the one that is wrong when a purchase landed on another device or a
      // read failed and returned zero.
      //
      // What is kept is the reporting: credits_before still describes what the
      // app believed, which is what makes the funnel readable.
      const creditsBefore = getCreditState().balance;
      const isPro = getCreditState().isPro;

      // An identity has to exist before the upload, because the object goes to
      // this user's own folder and the charge is against this user.
      const identity = await requireIdentity('scan');
      if (!identity) {
        trackEvent('scan_failed', { reason: 'no_identity', vibe: selectedVibe });
        Alert.alert(
          "Couldn't Start",
          "We couldn't set this match up just now. Nothing was used and nothing was charged. Please try again in a moment.",
          [{ text: 'OK', onPress: leaveOnBlocked }]
        );
        return;
      }

      trackEvent('scan_started', {
        vibe: selectedVibe,
        from_onboarding: !!fromOnboarding,
        signed_in: !!userId,
        // What the CLIENT believed before the scan. Null means it had not
        // heard from the server yet, which is different from zero and is now
        // visible as such in the funnel.
        credits_before: creditsBefore,
        is_last_credit: creditsBefore === 1,
        is_pro: isPro,
        // How long the scan actually had to wait on the background resize.
        // Should be ~0; anything else means the prep is not keeping up.
        prep_wait_ms: prepWaitMs,
      });

      try {
        setProgress(5);
        // Derive the owner from the live session rather than the `userId` route
        // param. The server checks the upload path against the identity in the
        // Authorization header, so if the param is stale (session expired since
        // navigation) the two would disagree and the scan would 403.
        const { data: { session: uploadSession } } = await supabase.auth.getSession();
        const { filePath, signedUrl } = await uploadImageAndGetSignedUrl(
          preparedUri,
          uploadSession?.user?.id
        );
        uploadedFilePath = filePath;
        setProgress(25);

        // A guest's taste picks live in AsyncStorage, not in
        // spotify_taste_profiles, so the edge function cannot look them up and
        // they have to travel inline.
        //
        // `!s?.user` stopped meaning "guest" when every install got an
        // anonymous uid, which silently stopped sending the picks of every
        // guest who had chosen a taste on the previous build: the server found
        // no row for their brand new uid and matched them generically from
        // then on. The server prefers an inline profile over the row, so
        // sending it is safe even once a row exists.
        let guestTasteProfile: any = null;
        try {
          const { data: { session: s } } = await supabase.auth.getSession();
          if (!s?.user || s.user.is_anonymous) {
            const { loadGuestTasteProfile } = await import('../../../lib/spotify');
            guestTasteProfile = await loadGuestTasteProfile();
          }
        } catch (err) {
          console.warn('Could not load guest taste profile:', err);
        }

        // Send the storage path, not a signed URL. The function reads the object
        // with the service role, so the client needs no read access to storage -
        // which is what lets guests work with an INSERT-only anon role.
        // Registered users get their past matches excluded server-side from
        // the history table. Guests have no row there, so their history goes
        // up with the request; without it a guest sees the same two songs for
        // every sunset.
        let avoidTracks: string[] = [];
        let avoidArtists: string[] = [];
        try {
          const recent = (await loadGuestHistory())
            .slice(0, GUEST_AVOID_ITEMS)
            .flatMap((item) => (Array.isArray(item.songs) ? item.songs : []));
          avoidTracks = Array.from(new Set(recent.map((s) => s?.title).filter((t): t is string => !!t)));
          avoidArtists = Array.from(new Set(recent.map((s) => s?.artist).filter((a): a is string => !!a)));
        } catch (err) {
          console.warn('Could not load guest history for the avoid list:', err);
        }

        // One id per photo, reused by every retry of that photo, so a repeat
        // replays the answer already paid for instead of buying a second one.
        const scanId = await scanIdForImage(preparedUri ?? String(image));

        const payload = {
          imagePath: filePath,
          vibe: selectedVibe,
          tasteProfile: guestTasteProfile ?? undefined,
          avoidTracks: avoidTracks.length ? avoidTracks : undefined,
          avoidArtists: avoidArtists.length ? avoidArtists : undefined,
          // Lets the server exclude what this install was already served,
          // even after the local history is gone.
          deviceId: await getDeviceId().catch(() => undefined),
          // Contract 2 means "charge me server-side". Builds that do not send
          // it are served under the old rules and charge themselves, which is
          // the only safe thing to do with a client that re-reads its balance
          // after the charge and demands its own arithmetic back.
          contract: 2,
          scanId,
          // Minutes to ADD to UTC for local time; getTimezoneOffset has the
          // opposite sign. Drives the Pro day boundary and next_free_at.
          tzOffsetMinutes: -new Date().getTimezoneOffset(),
        };
        
        let accessToken: string | undefined;
        let currentUserId: string | undefined;
        
        try {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          if (session?.access_token) {
            accessToken = session.access_token;
            currentUserId = session.user?.id;
          }
        } catch (error) {
          console.warn('Error getting session:', error);
        }
        
        setProgress(30);

        const estimatedApiTime = 6000;
        const apiStartTime = Date.now();
        
        const apiProgressInterval = setInterval(() => {
          const elapsed = Date.now() - apiStartTime;
          const progressPercent = Math.min(30 + (elapsed / estimatedApiTime) * 55, 85);
          setProgress(progressPercent);
        }, 150);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }

        if (__DEV__) {
          console.log('[recommend-songs] request', payload);
        }

        const response = await fetch('https://mebjzwwtuzwcrwugxjvu.supabase.co/functions/v1/recommend-songs', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        
        clearInterval(apiProgressInterval);
        setProgress(85);
        
        const data = await response.json();
        if (__DEV__) {
          const songs = Array.isArray(data?.songs) ? data.songs : [];
          console.log('[recommend-songs] response', {
            httpStatus: response.status,
            ok: response.ok,
            error: data?.error,
            code: data?.code,
            lastSpotifyHttpStatus: data?.lastSpotifyHttpStatus,
            message: data?.message,
            songCount: songs.length,
            songs: songs.map((s: { title?: string; artist?: string; spotify_url?: string }) => ({
              title: s?.title,
              artist: s?.artist,
              spotify_url: s?.spotify_url,
            })),
          });
        }
        setProgress(90);

        // Out of credits: the wall, not an error dialog. The server refused
        // before spending anything, so nothing was charged and there is
        // nothing to apologise for.
        // The same photo is already running, somewhere. Not an error, and
        // above all not a second charge: the server refused to start a
        // duplicate rather than paying for the model twice on one credit.
        if (response.status === 409 && data?.code === 'scan_in_flight') {
          trackEvent('scan_in_flight', { vibe: selectedVibe });
          Alert.alert(
            'Still Matching',
            "This photo is already being matched. Give it a moment and check your Vault.",
            [{ text: 'OK', onPress: leaveOnBlocked }]
          );
          return;
        }

        if (response.status === 402) {
          applyScanCredits(data?.credits);

          // A subscriber who has used today's matches is not a sales
          // opportunity. The credit wall would offer them a pack as the
          // primary action and promise a free match Pro never gets, under a
          // "Go Pro" button they already pressed.
          if (getCreditState().isPro) {
            trackEvent('pro_daily_cap_hit', { from_onboarding: !!fromOnboarding });
            Alert.alert(
              "That's today's matches",
              "You've used all of today's Pro matches. A fresh set unlocks at 9am.",
              [{ text: 'OK', onPress: leaveOnBlocked }]
            );
            return;
          }

          trackEvent('out_of_credits', {
            source: 'analyzing_402',
            credits_balance: data?.credits?.balance ?? 0,
            from_onboarding: !!fromOnboarding,
          });
          setShowWall(true);
          return;
        }

        if (!response.ok || data.error || !data.songs) {
          // Not every failure is a missing match: quota exhaustion, Spotify auth
          // and 5xx all landed here and were reported as "No Matches Found",
          // blaming the photo for an outage.
          const failure = describeScanFailure(response.status, data);
          trackEvent('scan_failed', {
            reason: failure.reason,
            http_status: response.status,
            error_code: data?.code ?? data?.details?.error?.code ?? null,
            vibe: selectedVibe,
            duration_ms: Date.now() - scanStartTime,
          });
          setProgress(100);
          Animated.timing(progressAnim, {
            toValue: 100,
            duration: 500,
            useNativeDriver: false,
          }).start(() => {
            setTimeout(() => {
              const fallbackNav = fromOnboarding
                ? () => (navigation as any).reset({ index: 0, routes: [{ name: 'MainTabs' }] })
                : () => (navigation as any).navigate('Dashboard');
              Alert.alert(
                failure.title,
                failure.message,
                [{ text: 'OK', onPress: fallbackNav }]
              );
            }, 300);
          });
          return;
        }

        const songs = data.songs || [];
        const hasValidResponse = Array.isArray(songs) && songs.length >= 3;

        if (!hasValidResponse) {
          trackEvent('scan_failed', {
            reason: 'too_few_songs',
            song_count: songs.length,
            vibe: selectedVibe,
            duration_ms: Date.now() - scanStartTime,
          });
          setProgress(100);
          Animated.timing(progressAnim, {
            toValue: 100,
            duration: 500,
            useNativeDriver: false,
          }).start(() => {
            setTimeout(() => {
              const fallbackNav2 = fromOnboarding
                ? () => (navigation as any).reset({ index: 0, routes: [{ name: 'MainTabs' }] })
                : () => (navigation as any).navigate('Dashboard');
              // This one really is a miss: the call succeeded, too little came back.
              Alert.alert(
                noMatchFailure().title,
                noMatchFailure().message,
                [{ text: 'OK', onPress: fallbackNav2 }]
              );
            }, 300);
          });
          return;
        }

        trackEvent('scan_completed', {
          vibe: selectedVibe,
          song_count: songs.length,
          from_onboarding: !!fromOnboarding,
          duration_ms: Date.now() - scanStartTime,
          credits_before: creditsBefore,
          // Whether the server had a taste profile to tune this match with.
          has_taste: typeof data?.has_taste === 'boolean' ? data.has_taste : undefined,
        });

        // No client-side charge. The server took the credit before it spent
        // anything on the model, and refunded it on every failure path, so by
        // the time we are here the accounting is already correct.
        //
        // What used to be here deducted a credit AFTER a successful match and,
        // if that write failed, withheld the result the user had just paid
        // for. Both halves are gone: the deduct because it is the server's
        // job, and the withholding because there is no longer a case where we
        // hold a match the user was charged for and refuse to show it.
        applyScanCredits(data?.credits);
        if (data?.credits?.balance === 0) {
          trackEvent('out_of_credits', {
            source: 'scan_completed',
            credits_balance: 0,
            from_onboarding: !!fromOnboarding,
          });
        }

        if (currentUserId && filePath && songs) {
          await supabase.from('history').insert([
            { user_id: currentUserId, image_url: filePath, songs: songs },
          ]);
        } else if (filePath && songs) {
          // Guests have no user_id, so the insert above skips them and their
          // match used to vanish the moment they left the results screen.
          // Keep it locally instead - HistoryScreen merges this into the Vault.
          await addGuestHistoryItem(filePath, songs);
        }

        // Count this genuine fresh match (drives the once-ever review prompt).
        // History re-views never reach here, so they don't inflate the count.
        try {
          await recordSuccessfulMatch();
        } catch {}

        // Value-first: only now (after a real success) ask for notification
        // permission, then (re)arm the gentle re-engagement ladder.
        try {
          await ensureNotificationPermission('post_match');
          await rescheduleEngagementReminders();
        } catch {}

        setProgress(95);
        setProgress(100);

        // A fresh match belongs to the Discover flow, not the Vault. It used
        // to be pushed onto the History stack, which parked that tab on a
        // result: tapping Vault days later reopened the first match instead of
        // the list, and the Vault tab sat highlighted while you looked at a
        // brand new match. The Vault stack is now only ever the archive.
        const resultParams = {
          // Guests get no signed URL; the local photo is already on screen and
          // is what the results view should show. Use the prepared copy, which
          // is also the object that was just uploaded.
          image: signedUrl ?? preparedUri,
          songs,
          imagePath: uploadedFilePath ?? undefined,
          fromFreshMatch: true,
        };

        const goToResults = () => {
          if (fromOnboarding) {
            // From root stack (OnboardingAnalyzing) - reset nav to MainTabs
            // with the Discover tab showing the result.
            (navigation as any).reset({
              index: 0,
              routes: [{
                name: 'MainTabs',
                params: {
                  screen: 'Home',
                  params: {
                    screen: 'Results',
                    params: { ...resultParams, fromOnboarding: true },
                  },
                },
              }],
            });
          } else {
            // Reset rather than push, so Analyzing is not left underneath:
            // back from the result goes to the Dashboard, never to a spinner
            // for a match that already finished.
            (navigation as any).reset({
              index: 1,
              routes: [
                { name: 'Dashboard' },
                { name: 'Results', params: resultParams },
              ],
            });
          }
        };

        // Finish the bar, then play the "Match found" reveal before handing off.
        Animated.timing(progressAnim, {
          toValue: 100,
          duration: 350,
          useNativeDriver: false,
        }).start(() => {
          setMatchSong(songs[0] || { title: 'Match found', artist: '' });
          triggerHaptic('success');
          scanningLoop.stop();
          cornerPulseLoop.stop();
          pulseDotLoop.stop();
          Animated.sequence([
            Animated.timing(revealBackdrop, { toValue: 1, duration: 260, useNativeDriver: true }),
            Animated.parallel([
              Animated.spring(checkScale, { toValue: 1, friction: 5, tension: 130, useNativeDriver: true }),
              Animated.timing(checkOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
            ]),
            Animated.delay(160),
            Animated.parallel([
              Animated.timing(cardOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
              Animated.spring(cardTranslate, { toValue: 0, friction: 7, tension: 80, useNativeDriver: true }),
            ]),
            Animated.delay(850),
          ]).start(() => goToResults());
        });
      } catch (error) {
        console.log('Error during analysis:', error);
        const netFailure = networkScanFailure();
        trackEvent('scan_failed', {
          reason: netFailure.reason,
          error_message: error instanceof Error ? error.message : String(error),
          vibe: selectedVibe,
          duration_ms: Date.now() - scanStartTime,
        });
        setProgress(100);
        Animated.timing(progressAnim, {
          toValue: 100,
          duration: 500,
          useNativeDriver: false,
        }).start(() => {
          setTimeout(() => {
            if (fromOnboarding) {
              // Don't leave user stuck - onboarding already marked complete, go to app
              Alert.alert(
                'Analysis Failed',
                'We couldn\'t analyze your photo this time. You can try again from the app!',
                [{ text: 'OK', onPress: () => (navigation as any).reset({ index: 0, routes: [{ name: 'MainTabs' }] }) }]
              );
            } else {
              Alert.alert(
                netFailure.title,
                netFailure.message,
                [{ text: 'OK', onPress: () => (navigation as any).navigate('Dashboard') }]
              );
            }
          }, 300);
        });
      }
    };

    analyzePhoto();

    return () => {
      clearInterval(tagInterval);
      scanningLoop.stop();
      cornerPulseLoop.stop();
      pulseDotLoop.stop();
    };
  }, [navigation, image, selectedVibe, userId, fromOnboarding, scanAttempt]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const imageSize = Math.min(width * 0.8, 320);
  const imageHeight = imageSize * 1.25;
  
  // Calculate translateY in pixels instead of percentage for native driver
  // Start at 10% of height, animate to 90% (80% total distance)
  const scanningLineY = scanningLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, imageHeight * 0.8],
  });

  return (
    <View style={styles.container}>
      {/* Background Blur Effects */}
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />
      {/* Background with blurred image overlay */}
      <View style={styles.backgroundImageContainer}>
        {displayUri ? (
          <Image source={{ uri: displayUri }} style={styles.backgroundImage} blurRadius={80} />
        ) : null}
        <LinearGradient
          colors={[DesignColors.backgroundDark + '60', DesignColors.backgroundDark + '80', DesignColors.backgroundDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic('light');
                (navigation as any).goBack();
              }}
              style={styles.closeButton}
            >
              <MaterialCommunityIcons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={styles.headerTitle}>
              <Text style={styles.headerSubtitle}>TuneMatch AI</Text>
              <Text style={styles.headerMainTitle}>Analysis</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          {/* Main Content */}
          <View style={styles.mainContent}>
            {/* Image with scanning line and corner boxes */}
            <View style={[styles.imageContainer, { width: imageSize, height: imageSize * 1.25 }]}>
              {displayUri ? <Image source={{ uri: displayUri }} style={styles.image} /> : null}
              <View style={styles.imageOverlay} />
              
              {/* Scanning line */}
              <Animated.View
                style={[
                  styles.scanningLine,
                  {
                    transform: [{ translateY: scanningLineY }],
                  },
                ]}
              />

              {/* Pulsing corner boxes */}
              <Animated.View
                style={[
                  styles.cornerBox,
                  styles.cornerTopLeft,
                  { transform: [{ scale: cornerPulseAnim }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.cornerBox,
                  styles.cornerTopRight,
                  { transform: [{ scale: cornerPulseAnim }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.cornerBox,
                  styles.cornerBottomLeft,
                  { transform: [{ scale: cornerPulseAnim }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.cornerBox,
                  styles.cornerBottomRight,
                  { transform: [{ scale: cornerPulseAnim }] },
                ]}
              />
            </View>

            {/* Title and Description */}
            <View style={styles.textContainer}>
              <Text style={styles.mainTitle}>Analyzing the Vibe...</Text>
              <Text style={styles.subtitle}>Matching the mood and atmosphere</Text>
            </View>

            {/* Cycling Tags */}
            <View style={styles.tagsContainer}>
              {tags.map((tag, index) => {
                const isActive = index === activeTagIndex;
                return (
                  <View
                    key={tag.id}
                    style={[
                      styles.tag,
                      isActive && styles.tagActive,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={tag.icon as any}
                      size={18}
                      color={isActive ? DesignColors.primary : 'rgba(255, 255, 255, 0.7)'}
                    />
                    <Text style={[styles.tagText, isActive && styles.tagTextActive]}>
                      {tag.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Progress Panel */}
          <View style={styles.progressPanel}>
            <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={styles.progressContent}>
              <View style={styles.progressRow}>
                <View style={styles.progressLabelRow}>
                  <MaterialCommunityIcons name="sync" size={20} color={DesignColors.primary} />
                  <Text style={styles.progressLabel}>Matching tempo and mood...</Text>
                </View>
                <Text style={styles.progressPercent}>{Math.round(progress)}%</Text>
              </View>
              
              <View style={styles.progressBarContainer}>
                <View style={styles.progressBarBackground}>
                  <Animated.View
                    style={[
                      styles.progressBarFill,
                      {
                        width: progressAnim.interpolate({
                          inputRange: [0, 100],
                          outputRange: ['0%', '100%'],
                        }),
                      },
                    ]}
                  >
                    <LinearGradient
                      colors={[DesignColors.primary + '60', DesignColors.primary]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </Animated.View>
                </View>
              </View>

              <View style={styles.progressFooter}>
                <Animated.View
                  style={[
                    styles.pulseDot,
                    { opacity: pulseDotAnim },
                  ]}
                />
                <Text style={styles.progressFooterText}>Processing Neural Audio Engine</Text>
              </View>
            </View>
          </View>
        </Animated.View>
      </SafeAreaView>

      {matchSong && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.revealOverlay, { opacity: revealBackdrop }]}>
          {displayUri ? (
            <Image source={{ uri: displayUri }} style={StyleSheet.absoluteFill} blurRadius={18} />
          ) : null}
          <View style={styles.revealScrim} />
          <View style={styles.revealCenter}>
            <Animated.View style={[styles.checkCircle, { opacity: checkOpacity, transform: [{ scale: checkScale }] }]}>
              <MaterialCommunityIcons name="check" size={40} color="#FFFFFF" />
            </Animated.View>
            <Animated.View style={{ opacity: cardOpacity, transform: [{ translateY: cardTranslate }], alignItems: 'center' }}>
              <Text style={styles.revealEyebrow}>MATCH FOUND</Text>
              {matchSong.album_cover ? (
                <Image source={{ uri: matchSong.album_cover }} style={styles.revealArt} />
              ) : (
                <View style={[styles.revealArt, styles.revealArtFallback]}>
                  <MaterialCommunityIcons name="music-note" size={44} color="rgba(255,255,255,0.6)" />
                </View>
              )}
              <Text style={styles.revealTitle} numberOfLines={1}>{matchSong.title}</Text>
              {!!matchSong.artist && <Text style={styles.revealArtist} numberOfLines={1}>{matchSong.artist}</Text>}
            </Animated.View>
          </View>
        </Animated.View>
      )}

      <WallSheet
        visible={showWall}
        source="analyzing_gate"
        credits={0}
        nextFreeAt={nextFreeAt}
        isAuthenticated={isRegistered}
        isPro={getCreditState().isPro}
        onClose={() => {
          setShowWall(false);
          leaveBlockedScan();
        }}
        onBoughtPack={() => {
          // Paid for matches with the photo still on screen: run the scan now.
          setShowWall(false);
          setScanAttempt((n) => n + 1);
        }}
        onGoPro={() => {
          setShowWall(false);
          wentToPaywall.current = true;
          (navigation as any).navigate('Payment');
        }}
        onRegister={() => {
          setShowWall(false);
          wentToPaywall.current = true;
          (navigation as any).navigate('SignUp');
        }}
      />
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
  revealOverlay: {
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DesignColors.backgroundDark,
  },
  revealScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,10,16,0.74)',
  },
  revealCenter: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  checkCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: DesignColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    shadowColor: DesignColors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
  },
  revealEyebrow: {
    color: '#FF7FB0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 16,
  },
  revealArt: {
    width: 150,
    height: 150,
    borderRadius: 18,
    marginBottom: 20,
    backgroundColor: '#2a1521',
  },
  revealArtFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  revealTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  revealArtist: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 15,
    marginTop: 4,
    textAlign: 'center',
  },
  backgroundImageContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.1 }],
  },
  content: {
    flex: 1,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    alignItems: 'center',
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: DesignColors.primary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  headerMainTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSpacer: {
    width: 40,
  },
  mainContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  imageContainer: {
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: DesignColors.primary + '30',
    overflow: 'hidden',
    position: 'relative',
    ...Shadows.prominent,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: DesignColors.primary + '05',
  },
  scanningLine: {
    position: 'absolute',
    top: '10%',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: DesignColors.primary,
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 15,
    elevation: 5,
  },
  cornerBox: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderColor: DesignColors.primary,
  },
  cornerTopLeft: {
    top: 16,
    left: 16,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  cornerTopRight: {
    top: 16,
    right: 16,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  cornerBottomLeft: {
    bottom: 16,
    left: 16,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  cornerBottomRight: {
    bottom: 16,
    right: 16,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
  textContainer: {
    marginTop: Spacing.xl,
    alignItems: 'center',
  },
  mainTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: Spacing.xl,
    gap: Spacing.sm,
    maxWidth: width - Spacing.lg * 2,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 9999,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    gap: Spacing.xs,
  },
  tagActive: {
    backgroundColor: DesignColors.primary + '20',
    borderWidth: 1,
    borderColor: DesignColors.primary + '40',
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 5,
  },
  tagText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  tagTextActive: {
    color: '#FFFFFF',
  },
  progressPanel: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: DesignColors.primary + '20',
    backgroundColor: 'rgba(34, 16, 25, 0.7)',
    overflow: 'hidden',
  },
  progressContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: '700',
    color: DesignColors.primary,
  },
  progressBarContainer: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  progressBarBackground: {
    width: '100%',
    height: '100%',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 5,
  },
  progressFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  pulseDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: DesignColors.primary,
  },
  progressFooterText: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  backgroundBlur1: {
    position: 'absolute',
    top: -height * 0.1,
    left: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: DesignColors.primary + '20',
    borderRadius: 9999,
    opacity: 0.3,
    zIndex: 0,
  },
  backgroundBlur2: {
    position: 'absolute',
    bottom: -height * 0.1,
    right: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: DesignColors.accentPurple + '20',
    borderRadius: 9999,
    opacity: 0.3,
    zIndex: 0,
  },
});

export default AnalyzingScreen;
