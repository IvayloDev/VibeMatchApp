import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Image,
  Alert,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCreditState } from '../../../lib/creditState';
import { trackEvent } from '../../../lib/posthog';
import { hasProEntitlement } from '../../../lib/revenuecat';
import { canProScanToday, PRO_DAILY_LIMIT } from '../../../lib/proQuota';
import { Spacing, BorderRadius, Shadows } from '../../../lib/designSystem';
import { VibeGrid } from '../../../lib/components/VibeGrid';
import WallSheet from '../../../lib/components/WallSheet';
import { nextLocalMidnight } from '../../../lib/dailyCredit';
import { useAuth } from '../../../lib/AuthContext';
import { getPreparedImage, peekPreparedImage } from '../../../lib/imagePrep';

const { width, height } = Dimensions.get('window');

const DesignColors = {
  primary: '#FF003C',
  accentPurple: '#8b5cf6',
  backgroundDark: '#221019',
};

type RootStackParamList = {
  Analyzing: { image: string; selectedVibe?: string };
  Payment: undefined;
  SignUp: undefined;
};

type RouteParams = {
  image: string;
};

const CARD_GAP = Spacing.md;
const GRID_PADDING = Spacing.lg;

const VibeSelectionScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { image } = (route.params || {}) as RouteParams;
  const { user, isRegistered } = useAuth();

  const [selectedVibe, setSelectedVibe] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showWall, setShowWall] = useState(false);
  const [nextFreeAt, setNextFreeAt] = useState<Date>(() => nextLocalMidnight());
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // The route param is the raw picked file, so the push could start on the
  // frame after the picker closed. Show it immediately, then swap to the
  // resized copy the moment it lands so this screen is not holding a
  // full-resolution bitmap for the rest of the flow. In practice the prep has
  // already finished by the time this screen mounts and the seed below is a
  // hit, so no swap happens at all.
  const [displayUri, setDisplayUri] = useState<string>(() => peekPreparedImage(image) ?? image);

  useEffect(() => {
    let cancelled = false;
    getPreparedImage(image).then((prepared) => {
      if (!cancelled && prepared) setDisplayUri(prepared);
    });
    return () => {
      cancelled = true;
    };
  }, [image]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleStartAnalysis = async () => {
    if (!selectedVibe) return;
    try {
      setLoading(true);
      // An early exit only, and only when we are sure. The server is what
      // actually refuses a scan it cannot charge for, and it does so before
      // spending anything, so a user whose balance we could not read still
      // reaches their match instead of being walled on a guess.
      //
      // No daily claim here either: granting credits is the server's job now,
      // and doing it on a screen transition is what used to write a 1 over a
      // real balance.
      const { balance, isPro, source } = getCreditState();
      if (!isPro && source === 'server' && balance === 0) {
        trackEvent('out_of_credits', { source: 'vibe_selection', credits_balance: 0 });
        setShowWall(true);
        return;
      }
      navigation.navigate('Analyzing', { image, selectedVibe });
    } catch (error) {
      console.error('Error starting analysis:', error);
      Alert.alert('Error', 'An error occurred while starting the analysis. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    (navigation as any).goBack();
  };


  return (
    <View style={styles.container}>
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={handleBack}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Pick a Vibe</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Image preview */}
          <View style={styles.previewWrapper}>
            <View style={styles.previewBorder}>
              <LinearGradient
                colors={[DesignColors.primary + '60', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.previewInner}>
                {displayUri ? (
                  <Image source={{ uri: displayUri }} style={styles.previewImage} />
                ) : null}
                <LinearGradient
                  colors={[DesignColors.backgroundDark + 'CC', 'transparent']}
                  start={{ x: 0, y: 1 }}
                  end={{ x: 0, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            </View>
          </View>

          {/* Subtitle */}
          <Text style={styles.subtitle}>Choose your mood</Text>

          {/* Vibe grid 2x2 (shared component) */}
          <VibeGrid
            selected={selectedVibe}
            onSelect={(id) => {
              trackEvent('vibe_selected', { vibe: id, from_onboarding: false });
              setSelectedVibe(id);
            }}
          />

          {/* Continue button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.continueButton, !selectedVibe && styles.continueButtonDisabled]}
              onPress={handleStartAnalysis}
              disabled={!selectedVibe || loading}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={
                  selectedVibe
                    ? [DesignColors.primary, '#E60035']
                    : ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.05)']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.continueGradient}
              >
                <Text
                  style={[
                    styles.continueText,
                    !selectedVibe && styles.continueTextDisabled,
                  ]}
                >
                  {loading ? 'Processing…' : 'Start Analysis'}
                </Text>
                {selectedVibe && (
                  <MaterialCommunityIcons name="auto-fix" size={20} color="#FFFFFF" />
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </SafeAreaView>

      <WallSheet
        visible={showWall}
        source="vibe_selection"
        credits={0}
        nextFreeAt={nextFreeAt}
        isAuthenticated={isRegistered}
        isPro={false}
        onClose={() => setShowWall(false)}
        onBoughtPack={() => {
          // The photo and mood are already chosen - straight into the scan.
          setShowWall(false);
          navigation.navigate('Analyzing', { image, selectedVibe: selectedVibe ?? undefined });
        }}
        onGoPro={() => {
          setShowWall(false);
          navigation.navigate('Payment');
        }}
        onRegister={() => {
          setShowWall(false);
          navigation.navigate('SignUp');
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
  backgroundBlur1: {
    position: 'absolute',
    top: -height * 0.1,
    left: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: DesignColors.primary + '20',
    borderRadius: 9999,
    opacity: 0.3,
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
  },
  content: {
    flex: 1,
    paddingHorizontal: GRID_PADDING,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: 'rgba(255, 255, 255, 0.95)',
    textShadowColor: DesignColors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  previewWrapper: {
    width: '100%',
    // Absorb whatever vertical space is left after the header, mood grid and
    // CTA, so the photo reads like the results hero and the page never needs to
    // scroll - on a short screen the image shrinks instead of pushing content off.
    flex: 1,
    minHeight: 120,
    marginBottom: Spacing.lg,
  },
  previewBorder: {
    flex: 1,
    borderRadius: 28,
    padding: 1,
    overflow: 'hidden',
    ...Shadows.prominent,
    shadowColor: DesignColors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 20,
  },
  previewInner: {
    flex: 1,
    borderRadius: 27,
    overflow: 'hidden',
    backgroundColor: DesignColors.backgroundDark,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: Spacing.md,
    letterSpacing: 0.3,
  },
  footer: {
    paddingTop: Spacing.md,
    // Clear the floating bottom tab bar, which overlays this screen - otherwise
    // the flexed photo pushes the CTA underneath it.
    paddingBottom: 70,
  },
  continueButton: {
    borderRadius: 9999,
    overflow: 'hidden',
    ...Shadows.prominent,
    shadowColor: DesignColors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 24,
  },
  continueButtonDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  continueGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg - 4,
    gap: Spacing.sm,
  },
  continueText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: '#FFFFFF',
  },
  continueTextDisabled: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
});

export default VibeSelectionScreen;
