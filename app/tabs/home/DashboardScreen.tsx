import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, ScrollView, Animated, Dimensions, Pressable, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { getUserCredits } from '../../../lib/credits';
import { useAuth } from '../../../lib/AuthContext';
import { Colors, Typography, Spacing, Layout, BorderRadius, Shadows } from '../../../lib/designSystem';
import { AnimatedCounter } from '../../../lib/components/AnimatedCounter';
import { triggerHaptic } from '../../../lib/utils/haptics';

const { width, height } = Dimensions.get('window');

// Colors from HTML reference - matching AnalyzingScreen
const DesignColors = {
  primary: '#f4258c',
  accentPurple: '#8b5cf6',
  accentTeal: '#2dd4bf',
  backgroundDark: '#221019', // Matching AnalyzingScreen
  backgroundLight: '#f8f5f7',
};

type RootStackParamList = {
  RecommendationType: { image: string };
  Payment: undefined;
};

const DashboardScreen = () => {
  const { user } = useAuth();
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  const loadUserCredits = async () => {
    try {
      const userCredits = await getUserCredits();
      setCredits(userCredits);
    } catch (error) {
      console.error('Error loading credits:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserCredits();
    
    // Animate on mount
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadUserCredits();
    }, [])
  );

  const pickImage = async () => {
    triggerHaptic('light');
    if (credits < 1) {
      triggerHaptic('warning');
      Alert.alert(
        'No Credits Available',
        'You need at least 1 credit to analyze a photo. Would you like to purchase more credits?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Buy Credits', 
            onPress: () => {
              triggerHaptic('medium');
              navigation.navigate('Payment');
            }
          }
        ]
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      navigation.navigate('RecommendationType', { image: manipResult.uri });
    }
  };

  const handleButtonPress = () => {
    if (credits < 1) {
      navigation.navigate('Payment');
    } else {
      pickImage();
    }
  };

  const handleButtonPressIn = () => {
    Animated.spring(buttonScale, {
      toValue: 0.95,
      useNativeDriver: true,
      friction: 3,
      tension: 300,
    }).start();
  };

  const handleButtonPressOut = () => {
    Animated.spring(buttonScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 3,
      tension: 300,
    }).start();
  };

  return (
    <View style={styles.container}>
      {/* Background Blur Effects */}
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />
      
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View 
            style={[
              styles.header,
              {
                opacity: fadeAnim,
              },
            ]}
          >
            <View style={styles.headerContent}>
              {/* Left: Person Icon */}
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons name="account-circle" size={24} color="#FFFFFF" />
              </View>
              
              {/* Center: VibeMatch Title */}
              <View style={styles.titleContainer}>
                <Text style={styles.appTitle}>VibeMatch</Text>
                <View style={styles.titleUnderline} />
              </View>
              
              {/* Right: Credits Badge */}
              {!loading && (
                <Pressable
                  onPress={() => {
                    triggerHaptic('light');
                    navigation.navigate('Payment');
                  }}
                  style={styles.creditsBadge}
                >
                  <View style={styles.creditsTextContainer}>
                    <AnimatedCounter value={credits} duration={800} textStyle={styles.creditsValue} />
                    <Text style={styles.creditsText}> CREDITS</Text>
                  </View>
                </Pressable>
              )}
            </View>
          </Animated.View>

          {/* Main Heading */}
          <Animated.View 
            style={[
              styles.headingContainer,
              {
                opacity: fadeAnim,
              },
            ]}
          >
            <Text style={styles.mainHeading}>
              Turn your world into <Text style={styles.gradientText}>rhythm.</Text>
            </Text>
            <Text style={styles.subtitle}>AI-powered playlists inspired by your view</Text>
          </Animated.View>

          {/* Upload Card */}
          <Animated.View 
            style={[
              styles.uploadCardContainer,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            <Pressable
              onPress={handleButtonPress}
              style={({ pressed }) => [
                styles.uploadCard,
                pressed && styles.uploadCardPressed,
              ]}
            >
              <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={styles.uploadCardContent}>
                {/* Icon Circle */}
                <Animatable.View
                  animation="pulse"
                  iterationCount="infinite"
                  duration={3000}
                  style={styles.iconCircle}
                >
                  <LinearGradient
                    colors={[DesignColors.primary, DesignColors.accentPurple]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.iconCircleGradient}
                  >
                    <MaterialCommunityIcons name="image-plus" size={48} color="#FFFFFF" />
                  </LinearGradient>
                </Animatable.View>

                {/* Card Text */}
                <Text style={styles.uploadTitle}>Upload Your Vibe</Text>
                <Text style={styles.uploadDescription}>
                  Select a photo from your gallery to let AI analyze the mood
                </Text>

                {/* CTA Button */}
                <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
                  <TouchableOpacity
                    onPress={handleButtonPress}
                    onPressIn={handleButtonPressIn}
                    onPressOut={handleButtonPressOut}
                    style={styles.ctaButton}
                    activeOpacity={0.9}
                  >
                    <LinearGradient
                      colors={[DesignColors.primary, DesignColors.accentPurple]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.ctaButtonGradient}
                    >
                      <Text style={styles.ctaButtonText}>OPEN GALLERY</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>
              </View>
            </Pressable>
          </Animated.View>

          {/* Progress Indicator */}
          <Animated.View 
            style={[
              styles.progressContainer,
              {
                opacity: fadeAnim,
              },
            ]}
          >
            <View style={styles.progressRow}>
              <View style={styles.progressStep}>
                <View style={styles.progressIcon}>
                  <MaterialCommunityIcons name="image" size={16} color={DesignColors.primary} />
                </View>
                <Text style={styles.progressLabel}>UPLOAD</Text>
              </View>
              <View style={styles.progressLine} />
              <View style={styles.progressStep}>
                <View style={styles.progressIcon}>
                  <MaterialCommunityIcons name="brain" size={16} color={DesignColors.primary} />
                </View>
                <Text style={styles.progressLabel}>ANALYZE</Text>
              </View>
              <View style={styles.progressLine} />
              <View style={styles.progressStep}>
                <View style={styles.progressIcon}>
                  <MaterialCommunityIcons name="music" size={16} color={DesignColors.accentPurple} />
                </View>
                <Text style={styles.progressLabel}>SYNC</Text>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DesignColors.backgroundDark,
    position: 'relative',
  },
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100, // Space for bottom tab bar
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
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    zIndex: 10,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(40px)',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  titleUnderline: {
    height: 4,
    width: 32,
    backgroundColor: DesignColors.primary,
    borderRadius: 2,
    marginTop: 4,
  },
  creditsBadge: {
    backgroundColor: DesignColors.primary + '20',
    borderWidth: 1,
    borderColor: DesignColors.primary + '30',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
  },
  creditsTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  creditsText: {
    fontSize: 12,
    fontWeight: '700',
    color: DesignColors.primary,
    letterSpacing: 1,
  },
  creditsValue: {
    fontSize: 12,
    fontWeight: '700',
    color: DesignColors.primary,
  },
  headingContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    zIndex: 10,
  },
  mainHeading: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  gradientText: {
    color: DesignColors.primary, // Using primary red/pink color
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 12,
  },
  uploadCardContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    zIndex: 10,
  },
  uploadCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    overflow: 'hidden',
    minHeight: 280,
  },
  uploadCardPressed: {
    borderColor: DesignColors.primary + '50',
  },
  uploadCardContent: {
    padding: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    ...Shadows.prominent,
  },
  iconCircleGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  uploadTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  uploadDescription: {
    fontSize: 14,
    fontWeight: '400',
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 240,
  },
  ctaButton: {
    minWidth: 200,
    height: 56,
    borderRadius: 9999,
    overflow: 'hidden',
    marginTop: Spacing.md,
    ...Shadows.card,
  },
  ctaButtonGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  progressContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    zIndex: 10,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 320,
    alignSelf: 'center',
  },
  progressStep: {
    flex: 1,
    alignItems: 'center',
  },
  progressIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  progressLine: {
    height: 1,
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 24,
  },
});

export default DashboardScreen;
