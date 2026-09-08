import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Layout, BorderRadius } from '../../lib/designSystem';
import { connectSpotify } from '../../lib/spotify';
import { useAuth } from '../../lib/AuthContext';
import { trackEvent } from '../../lib/posthog';

type RootStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  ConnectSpotify: undefined;
  TastePicker: { returnTo?: 'back' } | undefined;
  Onboarding: undefined;
  MainTabs: undefined;
};

const { width, height } = Dimensions.get('window');

const SPOTIFY_GREEN = '#1DB954';

const ConnectSpotifyScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { refreshSpotifyStatus, onboardingComplete, user } = useAuth();
  const [loading, setLoading] = useState(false);

  // Where the flow goes after a real Spotify connection (a taste profile now
  // exists). Guests (no auth user) must always go through onboarding regardless
  // of any onboardingComplete flag left over from a prior registered session.
  const nextTarget = (): 'MainTabs' | 'Onboarding' =>
    (user && onboardingComplete) ? 'MainTabs' : 'Onboarding';

  // Without Spotify the app still needs a taste, so skipping lands on the
  // in-app picker, which continues to Onboarding by itself. Registered users
  // who already finished onboarding go straight back into the app.
  const skipTarget = (): 'MainTabs' | 'TastePicker' =>
    (user && onboardingComplete) ? 'MainTabs' : 'TastePicker';

  React.useEffect(() => {
    trackEvent('spotify_connect_shown');
  }, []);

  const handleSkip = () => {
    trackEvent('spotify_connect_skipped');
    navigation.reset({ index: 0, routes: [{ name: skipTarget() }] });
  };

  const handleConnect = async () => {
    setLoading(true);
    trackEvent('spotify_connect_tapped');
    try {
      const result = await connectSpotify();
      if (!result.success) {
        trackEvent('spotify_connect_failed', { error: result.error ?? 'unknown', reason: result.reason ?? 'unknown' });
        if (result.reason === 'not_allowlisted') {
          // OAuth went through but Spotify's Development-mode allowlist refuses
          // the account, so no listening data will ever load. Hand them to the
          // in-app picker instead of a dead end.
          Alert.alert(
            'Spotify kept its data',
            'Spotify only shares listening history with approved apps. Pick your taste by hand instead and every match is still tuned to you.',
            [{ text: 'Pick my taste', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'TastePicker' }] }) }],
          );
          return;
        }
        Alert.alert('Spotify Connection', result.error ?? 'Could not connect to Spotify');
        return;
      }
      trackEvent('spotify_connect_success');
      // Do NOT call refreshSpotifyStatus() for guests: it flips spotifyChecking
      // in AuthContext, which unmounts the NavigationContainer (App.js shows the
      // LoadingScreen) and then remounts it at getTarget() = 'Welcome' for a
      // guest (no auth user) - bouncing them back to the splash and discarding
      // the navigation.reset below. Registered users still need the refresh so
      // their getTarget-based routing reflects the new connection.
      if (user) {
        await refreshSpotifyStatus();
      } else {
        // Guests still need AuthContext to know they are connected, or screens
        // that read spotifyConnected (e.g. the Profile prompt) keep asking them
        // to connect. The silent variant leaves spotifyChecking alone, so it
        // updates the flag without the unmount/bounce described above.
        await refreshSpotifyStatus({ silent: true });
      }
      const target = nextTarget();
      console.log('[ConnectSpotify] user:', !!user, 'onboardingComplete:', onboardingComplete, '→', target);
      navigation.reset({ index: 0, routes: [{ name: target }] });
    } catch (err: any) {
      trackEvent('spotify_connect_failed', { error: err?.message ?? 'exception', reason: 'screen_exception' });
      Alert.alert('Spotify Connection', err?.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            trackEvent('spotify_connect_abandoned');
            navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
          }}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="spotify" size={96} color={SPOTIFY_GREEN} />
          </View>

          <Text style={styles.title}>Connect Spotify</Text>
          <Text style={styles.subtitle}>
            Optional. Connect and TuneMatch tunes every match to your listening taste - including
            hidden gems you haven't heard yet.
          </Text>

          <View style={styles.bulletRow}>
            <MaterialCommunityIcons name="music-note" size={18} color={SPOTIFY_GREEN} />
            <Text style={styles.bulletText}>Your top artists &amp; genres</Text>
          </View>
          <View style={styles.bulletRow}>
            <MaterialCommunityIcons name="heart-outline" size={18} color={SPOTIFY_GREEN} />
            <Text style={styles.bulletText}>Recently played &amp; saved tracks</Text>
          </View>
          <View style={styles.bulletRow}>
            <MaterialCommunityIcons name="shield-check-outline" size={18} color={SPOTIFY_GREEN} />
            <Text style={styles.bulletText}>Read-only. We never post on your behalf.</Text>
          </View>

          <TouchableOpacity
            style={styles.connectButton}
            onPress={handleConnect}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="spotify" size={22} color="#FFFFFF" />
                <Text style={styles.connectButtonText}>Continue with Spotify</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkip}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            No Spotify? Skip and pick your taste by hand. Matching works either way.
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#221019',
  },
  safeArea: { flex: 1 },
  backButton: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  backgroundBlur1: {
    position: 'absolute',
    top: -height * 0.1,
    left: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: '#1DB95420',
    borderRadius: 9999,
    opacity: 0.35,
  },
  backgroundBlur2: {
    position: 'absolute',
    bottom: -height * 0.1,
    right: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: '#f4258c20',
    borderRadius: 9999,
    opacity: 0.3,
  },
  content: {
    flex: 1,
    paddingHorizontal: Layout.screenPadding,
    justifyContent: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: Spacing.sm,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.md,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  bulletText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: SPOTIFY_GREEN,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md + 4,
    marginTop: Spacing.xl,
    shadowColor: SPOTIFY_GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  skipButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  skipButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
  },
  footnote: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
});

export default ConnectSpotifyScreen;
