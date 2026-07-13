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
import { getUserCredits } from '../../../lib/credits';
import { Spacing, BorderRadius, Shadows } from '../../../lib/designSystem';
import { VibeGrid } from '../../../lib/components/VibeGrid';

const { width, height } = Dimensions.get('window');

const DesignColors = {
  primary: '#FF003C',
  accentPurple: '#8b5cf6',
  backgroundDark: '#221019',
};

type RootStackParamList = {
  Analyzing: { image: string; selectedVibe?: string };
  Payment: undefined;
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

  const [selectedVibe, setSelectedVibe] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

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
      const currentCredits = await getUserCredits();
      if (currentCredits < 1) {
        Alert.alert(
          'No Credits Available',
          'You need at least 1 credit to analyze a photo. Would you like to purchase more credits?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Buy Credits', onPress: () => navigation.navigate('Payment') },
          ]
        );
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

  const previewHeight = width * 0.42;

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
          <View style={[styles.previewWrapper, { height: previewHeight }]}>
            <View style={styles.previewBorder}>
              <LinearGradient
                colors={[DesignColors.primary + '60', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.previewInner}>
                {image ? (
                  <Image source={{ uri: image }} style={styles.previewImage} />
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
          <VibeGrid selected={selectedVibe} onSelect={setSelectedVibe} />

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
    paddingBottom: Spacing.sm,
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
