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

type RootStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  ConnectSpotify: undefined;
  Onboarding: undefined;
  MainTabs: undefined;
};

const { width, height } = Dimensions.get('window');

const SPOTIFY_GREEN = '#1DB954';

const ConnectSpotifyScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { refreshSpotifyStatus, onboardingComplete, user } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const result = await connectSpotify();
      if (!result.success) {
        Alert.alert('Spotify Connection', result.error ?? 'Could not connect to Spotify');
        return;
      }
      await refreshSpotifyStatus();
      // Guests (no auth user) must always go through onboarding regardless of
      // any onboardingComplete flag left over from a prior registered session.
      const target = (user && onboardingComplete) ? 'MainTabs' : 'Onboarding';
      console.log('[ConnectSpotify] user:', !!user, 'onboardingComplete:', onboardingComplete, '→', target);
      navigation.reset({ index: 0, routes: [{ name: target }] });
    } catch (err: any) {
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
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] })}
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
            TuneMatch uses your listening taste to surface songs you'll actually love — including
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

          <Text style={styles.footnote}>
            Required to personalize your recommendations. You can disconnect by deleting the app.
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
  footnote: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
});

export default ConnectSpotifyScreen;
