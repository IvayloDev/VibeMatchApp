import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, ScrollView, Animated, Dimensions } from 'react-native';
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
import { FloatingCard } from '../../../lib/components/FloatingCard';
import { ModernButton } from '../../../lib/components/ModernButton';
import { SkeletonCreditDisplay } from '../../../lib/components/SkeletonLoader';
import { AnimatedCounter } from '../../../lib/components/AnimatedCounter';
import { triggerHaptic } from '../../../lib/utils/haptics';

const { width } = Dimensions.get('window');

type RootStackParamList = {
  RecommendationType: { image: string };
  Payment: undefined;
  // ...other routes
};

const DashboardScreen = () => {
  const { user } = useAuth();
  
  // Extract username from email (part before @) and capitalize it
  const getUserName = () => {
    if (!user?.email) return 'User';
    const emailPart = user.email.split('@')[0];
    // Capitalize first letter and handle common separators
    return emailPart
      .split(/[._-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ') || 'User';
  };
  
  const userName = getUserName();
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

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

  // Load credits on mount
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

  // Refresh credits when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadUserCredits();
    }, [])
  );

  const pickImage = async () => {
    triggerHaptic('light');
    // Check if user has enough credits before allowing image selection
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
      // Resize and compress the image before using it
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      navigation.navigate('RecommendationType', { image: manipResult.uri });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section with Gradient Background */}
        <Animated.View 
          style={[
            styles.heroSection,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <LinearGradient
            colors={[Colors.accent.blue + '20', Colors.accent.coral + '10', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          
          {/* Header with Credits */}
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View style={styles.userNameContainer}>
                <View style={styles.greetingRow}>
                  <Text style={styles.greeting}>Welcome back</Text>
                  <Text style={styles.wave}>👋</Text>
                </View>
                <Text style={styles.userName} numberOfLines={1} ellipsizeMode="tail">
                  {userName}
                </Text>
              </View>
              
              {loading ? (
                <SkeletonCreditDisplay />
              ) : (
                <Animatable.View 
                  animation="pulse" 
                  iterationCount="infinite" 
                  duration={2000}
                  style={styles.creditsCard}
                >
                  <BlurView intensity={60} tint="dark" style={styles.creditsBlur}>
                    <LinearGradient
                      colors={[Colors.accent.green + '30', Colors.accent.blue + '20']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.creditsGradient}
                    >
                      <View style={styles.creditsContent}>
                        <MaterialCommunityIcons 
                          name="diamond-stone" 
                          size={20} 
                          color={Colors.accent.green} 
                          style={styles.creditsIcon}
                        />
                        <View style={styles.creditsTextContainer}>
                          <AnimatedCounter 
                            value={credits} 
                            duration={800}
                            style={styles.creditsValue}
                          />
                          <Text style={styles.creditsLabel}>Credits</Text>
                        </View>
                      </View>
                    </LinearGradient>
                  </BlurView>
                </Animatable.View>
              )}
            </View>

            {/* Low Credits Alert */}
            {credits < 1 && !loading && (
              <Animatable.View 
                animation="fadeInDown" 
                duration={500}
                style={styles.alertCard}
              >
                <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
                <View style={styles.alertContent}>
                  <MaterialCommunityIcons 
                    name="alert-circle" 
                    size={20} 
                    color={Colors.accent.yellow} 
                  />
                  <Text style={styles.alertText}>
                    Low credits - Get more to continue analyzing
                  </Text>
                </View>
              </Animatable.View>
            )}
          </View>
        </Animated.View>

        {/* Main Feature Card */}
        <Animated.View 
          style={[
            styles.featureSection,
            {
              opacity: fadeAnim,
            },
          ]}
        >
          <Text style={styles.sectionTitle}>Discover Your Vibe</Text>
          <Text style={styles.sectionSubtitle}>
            Find songs that perfectly match your mood
          </Text>

          <Animatable.View 
            animation="fadeInUp" 
            duration={800}
            delay={200}
            style={styles.mainCardContainer}
          >
            <FloatingCard style={styles.mainFeatureCard}>
              {/* Gradient Border Effect */}
              <LinearGradient
                colors={[Colors.accent.blue + '40', Colors.accent.coral + '30', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cardGradient}
              />
              
              {/* Cost Badge */}
              <View style={styles.costBadge}>
                <LinearGradient
                  colors={[Colors.accent.green, Colors.accent.blue]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.badgeGradient}
                >
                  <MaterialCommunityIcons name="music-note" size={14} color={Colors.textPrimary} />
                  <Text style={styles.badgeText}>1 Credit = 3 Songs</Text>
                </LinearGradient>
              </View>

              {/* Feature Content */}
              <View style={styles.featureContent}>
                <Animatable.View 
                  animation="pulse" 
                  iterationCount="infinite" 
                  duration={3000}
                  style={styles.emojiContainer}
                >
                  <Text style={styles.featureEmoji}>📸</Text>
                </Animatable.View>
                
                <Text style={styles.featureTitle}>Mood Matching</Text>
                <Text style={styles.featureSubtitle}>
                  Upload a photo and let AI find songs that match your current vibe perfectly
                </Text>

                <View style={styles.featureStats}>
                  <View style={styles.statItem}>
                    <MaterialCommunityIcons name="lightning-bolt" size={18} color={Colors.accent.yellow} />
                    <Text style={styles.statText}>Instant Results</Text>
                  </View>
                  <View style={styles.statItem}>
                    <MaterialCommunityIcons name="music-circle" size={18} color={Colors.accent.blue} />
                    <Text style={styles.statText}>3 Songs</Text>
                  </View>
                  <View style={styles.statItem}>
                    <MaterialCommunityIcons name="star" size={18} color={Colors.accent.coral} />
                    <Text style={styles.statText}>Curated</Text>
                  </View>
                </View>
              </View>
              
              <ModernButton
                title={credits < 1 ? "Get Credits" : "Start Analyzing"}
                onPress={credits < 1 ? () => navigation.navigate('Payment') : pickImage}
                variant={credits < 1 ? "secondary" : "primary"}
                style={styles.analyzeButton}
              />
            </FloatingCard>
          </Animatable.View>
        </Animated.View>

        {/* Bottom Spacing */}
        <View style={styles.bottomSpacing} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xl,
  },
  heroSection: {
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    position: 'relative',
    overflow: 'hidden',
  },
  header: {
    zIndex: 1,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  userNameContainer: {
    flex: 1,
    minWidth: 0,
    marginRight: Spacing.md,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: 2,
  },
  greeting: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 13,
  },
  userName: {
    ...Typography.heading2,
    fontSize: 20,
    fontWeight: '600',
  },
  wave: {
    fontSize: 16,
  },
  creditsCard: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    ...Shadows.prominent,
  },
  creditsBlur: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
  },
  creditsGradient: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xl,
  },
  creditsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  creditsIcon: {
    marginRight: 4,
  },
  creditsTextContainer: {
    alignItems: 'flex-start',
  },
  creditsValue: {
    ...Typography.heading3,
    color: Colors.accent.green,
    fontWeight: '700',
    fontSize: 20,
    lineHeight: 22,
  },
  creditsLabel: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: -2,
  },
  alertCard: {
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.accent.yellow + '40',
  },
  alertContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  alertText: {
    ...Typography.caption,
    color: Colors.accent.yellow,
    flex: 1,
    fontSize: 13,
  },
  featureSection: {
    paddingHorizontal: Layout.screenPadding,
    marginTop: Spacing.md,
  },
  sectionTitle: {
    ...Typography.heading1,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  sectionSubtitle: {
    ...Typography.body,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    color: Colors.textSecondary,
  },
  mainCardContainer: {
    marginBottom: Spacing.lg,
  },
  mainFeatureCard: {
    alignItems: 'center',
    position: 'relative',
    paddingTop: Spacing.xl + Spacing.md,
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    opacity: 0.6,
  },
  costBadge: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    borderRadius: BorderRadius.round,
    overflow: 'hidden',
    ...Shadows.card,
  },
  badgeGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  badgeText: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: '600',
    fontSize: 12,
  },
  featureContent: {
    alignItems: 'center',
    width: '100%',
    zIndex: 1,
  },
  emojiContainer: {
    marginBottom: Spacing.md,
  },
  featureEmoji: {
    fontSize: 64,
  },
  featureTitle: {
    ...Typography.heading2,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  featureSubtitle: {
    ...Typography.body,
    textAlign: 'center',
    marginBottom: Spacing.lg,
    color: Colors.textSecondary,
    lineHeight: 22,
    paddingHorizontal: Spacing.sm,
  },
  featureStats: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.cardBackgroundSecondary + '80',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  statText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  analyzeButton: {
    width: '100%',
    marginTop: Spacing.md,
  },
  bottomSpacing: {
    height: Spacing.xxl,
  },
});

export default DashboardScreen;