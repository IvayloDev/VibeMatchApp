import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Alert, TouchableOpacity, Animated, Dimensions, ScrollView, TextInput, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getUserCredits } from '../../../lib/credits';
import { Colors, Typography, Spacing, BorderRadius, Shadows, Layout } from '../../../lib/designSystem';
import { FloatingCard } from '../../../lib/components/FloatingCard';
import { ModernButton } from '../../../lib/components/ModernButton';
import { triggerHaptic } from '../../../lib/utils/haptics';

const { width } = Dimensions.get('window');

type RootStackParamList = {
  Analyzing: { image: string; type: 'surprise' | 'genre'; selectedGenre?: string; customRequest?: string };
  Payment: undefined;
  // ...other routes
};

type RouteParams = {
  image: string;
};

// Popular genres - full list
const popularGenres = [
  { id: 'pop', name: 'Pop', emoji: '🎵', color: Colors.accent.blue },
  { id: 'rock', name: 'Rock', emoji: '🤘', color: Colors.accent.red },
  { id: 'electronic', name: 'Electronic', emoji: '⚡', color: Colors.accent.yellow },
  { id: 'hiphop', name: 'Hip Hop', emoji: '🎧', color: Colors.accent.coral },
  { id: 'rap', name: 'Rap', emoji: '🎤', color: Colors.accent.red },
  { id: 'jazz', name: 'Jazz', emoji: '🎷', color: Colors.accent.blue },
  { id: 'chill', name: 'Chill', emoji: '😌', color: Colors.accent.blue },
  { id: 'energetic', name: 'Energetic', emoji: '🔥', color: Colors.accent.red },
  { id: 'romantic', name: 'Romantic', emoji: '💕', color: Colors.accent.coral },
  { id: 'indie', name: 'Indie', emoji: '🎸', color: Colors.accent.blue },
  { id: 'r&b', name: 'R&B', emoji: '🎤', color: Colors.accent.coral },
  { id: 'country', name: 'Country', emoji: '🤠', color: Colors.accent.yellow },
  { id: 'classical', name: 'Classical', emoji: '🎻', color: Colors.accent.blue },
  { id: 'reggae', name: 'Reggae', emoji: '🌴', color: Colors.accent.green },
  { id: 'latin', name: 'Latin', emoji: '💃', color: Colors.accent.red },
  { id: 'metal', name: 'Metal', emoji: '🤘', color: Colors.accent.red },
  { id: 'folk', name: 'Folk', emoji: '🌾', color: Colors.accent.yellow },
  { id: 'blues', name: 'Blues', emoji: '🎹', color: Colors.accent.blue },
  { id: 'dance', name: 'Dance', emoji: '💃', color: Colors.accent.coral },
  { id: 'alternative', name: 'Alternative', emoji: '🎸', color: Colors.accent.yellow },
  { id: 'punk', name: 'Punk', emoji: '⚡', color: Colors.accent.red },
  { id: 'soul', name: 'Soul', emoji: '🎤', color: Colors.accent.coral },
  { id: 'funk', name: 'Funk', emoji: '🎺', color: Colors.accent.green },
  { id: 'disco', name: 'Disco', emoji: '🕺', color: Colors.accent.yellow },
  { id: 'ambient', name: 'Ambient', emoji: '🌙', color: Colors.accent.blue },
  { id: 'techno', name: 'Techno', emoji: '🎛️', color: Colors.accent.yellow },
  { id: 'house', name: 'House', emoji: '🏠', color: Colors.accent.coral },
  { id: 'trap', name: 'Trap', emoji: '🎚️', color: Colors.accent.red },
  { id: 'kpop', name: 'K-Pop', emoji: '✨', color: Colors.accent.coral },
  { id: 'gospel', name: 'Gospel', emoji: '🙏', color: Colors.accent.yellow },
  { id: 'funny', name: 'Funny', emoji: '😂', color: Colors.accent.yellow },
];

const RecommendationTypeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { image } = (route.params || {}) as RouteParams;
  const [type, setType] = useState<'surprise' | 'genre'>('surprise');
  const [selectedGenre, setSelectedGenre] = useState(popularGenres[0].id);
  const [customRequest, setCustomRequest] = useState('');
  const [isCustomExpanded, setIsCustomExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const customRequestHeight = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleStartAnalysis = async () => {
    try {
      setLoading(true);
      triggerHaptic('medium');

      // Check if user has enough credits first (but don't deduct yet)
      const currentCredits = await getUserCredits();
      if (currentCredits < 1) {
        Alert.alert(
          'No Credits Available',
          'You need at least 1 credit to analyze a photo. Would you like to purchase more credits?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Buy Credits', onPress: () => navigation.navigate('Payment') }
          ]
        );
        return;
      }

      // Navigate to analyzing screen with the selected options
      // If customRequest is provided, it will override the genre
      const finalCustomRequest = customRequest.trim() || undefined;
      const finalSelectedGenre = finalCustomRequest ? undefined : (type === 'genre' ? selectedGenre : undefined);
      // If custom request is used, we still use type 'genre' but with customRequest parameter
      const finalType = finalCustomRequest ? 'genre' : type;
      
      console.log('📤 [RecommendationTypeScreen] Navigating to Analyzing with:', {
        type: finalType,
        selectedGenre: finalSelectedGenre || 'N/A',
        customRequest: finalCustomRequest || 'N/A',
        hasCustomRequest: !!finalCustomRequest,
        hasGenre: !!finalSelectedGenre,
      });
      
      navigation.navigate('Analyzing', { 
        image, 
        type: finalType, 
        selectedGenre: finalSelectedGenre,
        customRequest: finalCustomRequest
      });

    } catch (error) {
      console.error('Error starting analysis:', error);
      Alert.alert(
        'Error',
        'An error occurred while starting the analysis. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSurprisePress = () => {
    triggerHaptic('light');
    setType('surprise');
    setIsCustomExpanded(false);
    // Collapse custom request when surprise is selected
    Animated.timing(customRequestHeight, {
      toValue: 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const handleGenrePress = (genreId: string) => {
    triggerHaptic('light');
    setType('genre');
    setSelectedGenre(genreId);
    setIsCustomExpanded(false);
    // Collapse custom request when genre is selected
    Animated.timing(customRequestHeight, {
      toValue: 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const handleCustomExpand = () => {
    triggerHaptic('light');
    const toValue = isCustomExpanded ? 0 : 1;
    setIsCustomExpanded(!isCustomExpanded);
    
    Animated.timing(customRequestHeight, {
      toValue: toValue,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const handleCustomTryNow = () => {
    triggerHaptic('medium');
    if (!customRequest.trim()) {
      Alert.alert('Custom Request Required', 'Please enter your custom request before trying it.');
      return;
    }
    // Auto-expand if needed
    if (!isCustomExpanded) {
      setIsCustomExpanded(true);
      Animated.timing(customRequestHeight, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start(() => {
        handleStartAnalysis();
      });
    } else {
      // Custom request overrides everything, so we can proceed directly
      handleStartAnalysis();
    }
  };

  const handleBack = () => {
    triggerHaptic('light');
    (navigation as any).navigate('Dashboard');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Background gradient */}
      <LinearGradient
        colors={[Colors.accent.blue + '10', Colors.accent.coral + '08', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        indicatorStyle="white"
        scrollEventThrottle={16}
        alwaysBounceVertical={false}
      >
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {/* Header with back button and title */}
          <View style={styles.header}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={handleBack}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons 
                name="arrow-left" 
                size={22} 
                color={Colors.textPrimary} 
              />
            </TouchableOpacity>
            <Text style={styles.title}>Choose Your Vibe</Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* Image at the top - Full width */}
          {image && (
            <Animatable.View 
              animation="fadeInDown" 
              duration={500}
              style={styles.imageContainer}
            >
              <FloatingCard style={styles.imageCard}>
                <Image source={{ uri: image }} style={styles.image} />
                <LinearGradient
                  colors={['transparent', Colors.accent.blue + '15']}
                  start={{ x: 0, y: 0.7 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.imageGradient}
                />
              </FloatingCard>
            </Animatable.View>
          )}

          {/* Surprise Me Option - Below image */}
          <Animatable.View 
            animation="fadeInUp" 
            duration={400}
            delay={100}
            style={styles.surpriseSection}
          >
            <TouchableOpacity
              style={[
                styles.surpriseCard,
                type === 'surprise' && styles.selectedSurpriseCard
              ]}
              onPress={handleSurprisePress}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={
                  type === 'surprise' 
                    ? [Colors.accent.blue + '25', Colors.accent.coral + '15']
                    : [Colors.cardBackground, Colors.cardBackgroundSecondary]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.surpriseGradient}
              />
              <View style={styles.surpriseContent}>
                <View style={styles.surpriseIconContainer}>
                  <Text style={styles.surpriseEmoji}>🎲</Text>
                </View>
                <View style={styles.surpriseTextContainer}>
                  <Text style={[
                    styles.surpriseText,
                    type === 'surprise' && styles.selectedSurpriseText
                  ]}>
                    Surprise Me
                  </Text>
                  <Text style={styles.surpriseSubtext}>
                    Let AI choose the perfect genre for you
                  </Text>
                </View>
                {type === 'surprise' && (
                  <View style={styles.checkContainer}>
                    <MaterialCommunityIcons 
                      name="check-circle" 
                      size={22} 
                      color={Colors.accent.blue} 
                    />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </Animatable.View>

          {/* Custom Request - Below Surprise Me */}
          <Animatable.View 
            animation="fadeInUp" 
            duration={400}
            delay={150}
            style={styles.customRequestSection}
          >
            <FloatingCard style={styles.customRequestCard} padding={0}>
              <TouchableOpacity
                style={styles.customRequestHeaderButton}
                onPress={handleCustomExpand}
                activeOpacity={0.7}
              >
                <View style={styles.customRequestHeader}>
                  <View style={styles.customRequestHeaderCenter}>
                    <MaterialCommunityIcons 
                      name="text-box-outline" 
                      size={16} 
                      color={Colors.textSecondary} 
                    />
                    <Text style={styles.customRequestLabel}>
                      Custom Request
                    </Text>
                    <View style={styles.experimentalBadge}>
                      <Text style={styles.experimentalBadgeText}>EXPERIMENTAL</Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons 
                    name={isCustomExpanded ? "chevron-up" : "chevron-down"} 
                    size={18} 
                    color={Colors.textSecondary} 
                  />
                </View>
              </TouchableOpacity>

              {/* Expandable Content */}
              <Animated.View
                style={[
                  styles.customRequestExpanded,
                  {
                        maxHeight: customRequestHeight.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 240],
                        }),
                    opacity: customRequestHeight,
                  }
                ]}
              >
                <TextInput
                  style={styles.customRequestInput}
                  placeholder="e.g., 'upbeat workout music', 'sad rainy day vibes', 'jazz fusion'"
                  placeholderTextColor={Colors.textSecondary + '80'}
                  value={customRequest}
                  onChangeText={setCustomRequest}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                {customRequest.trim().length > 0 && (
                  <View style={styles.customRequestHint}>
                    <MaterialCommunityIcons 
                      name="information-outline" 
                      size={14} 
                      color={Colors.accent.blue} 
                    />
                    <Text style={styles.customRequestHintText}>
                      This will override the selected genre
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.tryNowButton}
                  onPress={handleCustomTryNow}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[Colors.accent.coral, Colors.accent.blue]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.tryNowButtonGradient}
                  >
                    <Text style={styles.tryNowButtonText}>Try Now</Text>
                    <MaterialCommunityIcons 
                      name="arrow-right" 
                      size={18} 
                      color={Colors.textPrimary} 
                    />
                  </LinearGradient>
                </TouchableOpacity>
              </Animated.View>
            </FloatingCard>
          </Animatable.View>

          {/* Genres Section */}
          <View style={styles.genresSection}>
            <Text style={styles.genresTitle}>Or pick a genre:</Text>
            <View style={styles.genresGrid}>
              {popularGenres.map((genre, index) => (
                <Animatable.View
                  key={genre.id}
                  animation="fadeInUp"
                  duration={300}
                  delay={200 + index * 30}
                >
                  <TouchableOpacity
                    style={[
                      styles.genreCard,
                      type === 'genre' && selectedGenre === genre.id && styles.selectedGenreCard
                    ]}
                    onPress={() => handleGenrePress(genre.id)}
                    activeOpacity={0.8}
                  >
                    <LinearGradient
                      colors={
                        type === 'genre' && selectedGenre === genre.id
                          ? [genre.color + '30', genre.color + '15']
                          : [Colors.cardBackground, Colors.cardBackgroundSecondary]
                      }
                      style={styles.genreGradient}
                    />
                    <Text style={styles.genreEmoji}>{genre.emoji}</Text>
                    <Text style={[
                      styles.genreName,
                      type === 'genre' && selectedGenre === genre.id && styles.selectedGenreName
                    ]}>
                      {genre.name}
                    </Text>
                    {type === 'genre' && selectedGenre === genre.id && (
                      <View style={styles.genreCheckBadge}>
                        <MaterialCommunityIcons 
                          name="check" 
                          size={16} 
                          color={Colors.textPrimary} 
                        />
                      </View>
                    )}
                  </TouchableOpacity>
                </Animatable.View>
              ))}
            </View>
          </View>
        </Animated.View>
      </ScrollView>
      
      {/* Analyze Button - Fixed at bottom */}
      <View style={styles.buttonContainer}>
        <BlurView intensity={80} tint="dark" style={styles.buttonBlur} />
        <LinearGradient
          colors={[Colors.background + 'F0', Colors.background + 'E0']}
          style={styles.buttonGradient}
        />
        <ModernButton
          title={loading ? 'Processing...' : 'Start Analysis'}
          onPress={handleStartAnalysis}
          variant="primary"
          style={styles.startButton}
          disabled={loading}
        />
      </View>
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
    paddingBottom: 160,
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md + 4,
    position: 'relative',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.cardBackground + 'E0',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  title: {
    ...Typography.heading1,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    position: 'absolute',
    left: 0,
    right: 0,
  },
  headerSpacer: {
    width: 36,
  },
  imageContainer: {
    marginBottom: Spacing.lg,
  },
  imageCard: {
    width: '100%',
    height: width * 0.6,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
  },
  surpriseSection: {
    marginBottom: Spacing.lg,
  },
  surpriseCard: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  selectedSurpriseCard: {
    borderColor: Colors.accent.blue,
    ...Shadows.prominent,
  },
  surpriseGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  surpriseContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    zIndex: 1,
  },
  surpriseIconContainer: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accent.blue + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  surpriseEmoji: {
    fontSize: 22,
  },
  surpriseTextContainer: {
    flex: 1,
  },
  surpriseText: {
    ...Typography.heading3,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
    color: Colors.textPrimary,
  },
  selectedSurpriseText: {
    color: Colors.accent.blue,
  },
  surpriseSubtext: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.textSecondary,
  },
  checkContainer: {
    marginLeft: Spacing.xs,
  },
  customRequestSection: {
    width: '100%',
    marginBottom: Spacing.md,
  },
  customRequestCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    padding: 0,
  },
  customRequestHeaderButton: {
    width: '100%',
  },
  customRequestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md + 6,
    paddingBottom: 0,
    gap: Spacing.sm,
    minHeight: 48,
  },
  customRequestHeaderCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  customRequestLabel: {
    ...Typography.heading3,
    fontSize: 16,
    color: Colors.textPrimary,
    fontWeight: '700',
    lineHeight: 22,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  experimentalBadge: {
    backgroundColor: Colors.accent.yellow + '30',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
    marginLeft: 25,
    alignSelf: 'center',
  },
  experimentalBadgeText: {
    ...Typography.caption,
    fontSize: 7,
    color: Colors.accent.yellow,
    fontWeight: '700',
    letterSpacing: 0.2,
    lineHeight: 10,
    includeFontPadding: false,
  },
  customRequestExpanded: {
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  customRequestInput: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md + 2,
    paddingHorizontal: Spacing.md,
    minHeight: 80,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  customRequestHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  customRequestHintText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.accent.blue,
  },
  tryNowButton: {
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    ...Shadows.card,
  },
  tryNowButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xs,
  },
  tryNowButtonText: {
    ...Typography.button,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  genresSection: {
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  genresTitle: {
    ...Typography.heading3,
    fontSize: 16,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
    fontWeight: '600',
  },
  genresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  genreCard: {
    width: (width - Layout.screenPadding * 2 - Spacing.md * 2) / 3,
    aspectRatio: 1,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: Spacing.md,
    ...Shadows.card,
  },
  selectedGenreCard: {
    borderColor: Colors.accent.blue,
    borderWidth: 2.5,
    ...Shadows.prominent,
  },
  genreGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  genreEmoji: {
    fontSize: 32,
    marginBottom: Spacing.xs,
  },
  genreName: {
    ...Typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  selectedGenreName: {
    color: Colors.accent.blue,
    fontWeight: '700',
  },
  genreCheckBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.accent.blue,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.card,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.lg,
    paddingBottom: 100, // Space above tab bar
    zIndex: 10,
  },
  buttonBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  buttonGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  startButton: {
    width: '100%',
  },
});

export default RecommendationTypeScreen;