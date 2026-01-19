import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Alert, TouchableOpacity, Animated, Dimensions, ScrollView, Platform, PanResponder, TextInput } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getUserCredits } from '../../../lib/credits';
import { Spacing, BorderRadius, Shadows } from '../../../lib/designSystem';
import { triggerHaptic } from '../../../lib/utils/haptics';

const { width, height } = Dimensions.get('window');

// Bottom sheet constants
const COLLAPSED_HEIGHT = 380; // Height when collapsed - expanded down more
const EXPANDED_HEIGHT = height * 0.80; // Height when expanded - use 85% of screen height for maximum scrolling

// Colors matching HTML reference
const DesignColors = {
  primary: '#FF003C',
  magenta: '#D400FF',
  accentPurple: '#8b5cf6', // Matching DashboardScreen for background blur
  backgroundDark: '#221019', // Matching DashboardScreen background
  cardDark: 'rgba(255, 255, 255, 0.03)',
};

type RootStackParamList = {
  Analyzing: { image: string; type: 'surprise' | 'genre'; selectedGenre?: string; customRequest?: string };
  Payment: undefined;
};

type RouteParams = {
  image: string;
};

// Custom genres list - expanded with more options
const genreOptions = [
  { id: 'rock', name: 'Rock', icon: 'lightning-bolt' as const },
  { id: 'pop', name: 'Pop', icon: 'music' as const },
  { id: 'electronic', name: 'Electro', icon: 'equalizer' as const },
  { id: 'hiphop', name: 'Hip Hop', icon: 'microphone' as const },
  { id: 'jazz', name: 'Jazz', icon: 'piano' as const },
  { id: 'ambient', name: 'Ambient', icon: 'wave' as const },
  { id: 'chill', name: 'Lo-Fi', icon: 'coffee' as const },
  { id: 'techno', name: 'Techno', icon: 'amplifier' as const },
  { id: 'metal', name: 'Metal', icon: 'fire' as const },
  { id: 'country', name: 'Country', icon: 'music' as const },
  { id: 'blues', name: 'Blues', icon: 'music' as const },
  { id: 'reggae', name: 'Reggae', icon: 'music' as const },
  { id: 'classical', name: 'Classic', icon: 'violin' as const },
  { id: 'indie', name: 'Indie', icon: 'music' as const },
  { id: 'rnb', name: 'R&B', icon: 'microphone' as const },
  { id: 'soul', name: 'Soul', icon: 'heart' as const },
  { id: 'funk', name: 'Funk', icon: 'flash' as const },
  { id: 'disco', name: 'Disco', icon: 'star' as const },
  { id: 'house', name: 'House', icon: 'speaker' as const },
  { id: 'trance', name: 'Trance', icon: 'waveform' as const },
  { id: 'dubstep', name: 'Dubstep', icon: 'signal' as const },
  { id: 'folk', name: 'Folk', icon: 'music' as const },
  { id: 'latin', name: 'Latin', icon: 'music' as const },
  { id: 'punk', name: 'Punk', icon: 'rocket' as const },
  { id: 'edm', name: 'EDM', icon: 'equalizer' as const },
];

const RecommendationTypeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { image } = (route.params || {}) as RouteParams;
  const [type, setType] = useState<'surprise' | 'genre'>('surprise');
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [customRequest, setCustomRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseDotAnim = useRef(new Animated.Value(1)).current;
  
  // Bottom sheet animation - starts collapsed but showing more content
  // translateY negative = moves UP = shows more (expanded)
  // translateY 0 = shows less (collapsed)
  // When collapsed: translateY = 0 (shows COLLAPSED_HEIGHT at bottom)
  // When expanded: translateY = -maxY (moves up, shows EXPANDED_HEIGHT)
  const maxY = EXPANDED_HEIGHT - COLLAPSED_HEIGHT;
  
  // Initial offset - should be 0 for collapsed state
  const initialOffset = 0; // Collapsed state - translateY = 0 shows COLLAPSED_HEIGHT 
  
  const sheetTranslateY = useRef(new Animated.Value(initialOffset)).current;
  const lastSheetY = useRef(initialOffset);

  // Pan responder for bottom sheet drag
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        sheetTranslateY.setOffset(lastSheetY.current);
        sheetTranslateY.setValue(0);
        triggerHaptic('light');
      },
      onPanResponderMove: (_, gestureState) => {
        sheetTranslateY.setValue(gestureState.dy);
      },
      onPanResponderRelease: (_, gestureState) => {
        sheetTranslateY.flattenOffset();
        
        const currentY = lastSheetY.current + gestureState.dy;
        const midPoint = maxY / 2;
        
        // Determine snap point based on velocity and position
        // gestureState.dy positive = dragging down (collapse), negative = dragging up (expand)
        let targetY;
        if (Math.abs(gestureState.vy) > 0.5) {
          // Fast swipe - go to nearest edge
          targetY = gestureState.vy > 0 
            ? 0 // Dragging down = collapse (translateY = 0)
            : -maxY; // Dragging up = expand (translateY = -maxY)
        } else {
          // Slow drag - snap based on position
          targetY = currentY > -midPoint 
            ? 0 // Closer to collapsed
            : -maxY; // Closer to expanded
        }
        
        // Clamp values (translateY ranges from -maxY to 0)
        // Allow initial offset values that are within the valid range
        targetY = Math.max(-maxY, Math.min(0, targetY));
        lastSheetY.current = targetY;
        
        triggerHaptic('light');
        
        Animated.spring(sheetTranslateY, {
          toValue: targetY,
          useNativeDriver: false,
          tension: 65,
          friction: 11,
        }).start();
      },
    })
  ).current;

  useEffect(() => {
    // Set initial bottom sheet position - this ensures it starts at the correct offset
    sheetTranslateY.setValue(initialOffset);
    lastSheetY.current = initialOffset;

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    // Pulse dot animation
    const pulseLoop = Animated.loop(
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
    pulseLoop.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const handleStartAnalysis = async () => {
    try {
      setLoading(true);
      triggerHaptic('medium');

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

      const finalType = selectedGenre || customRequest ? 'genre' : 'surprise';
      const finalSelectedGenre = selectedGenre || undefined;
      const finalCustomRequest = customRequest.trim() || undefined;
      
      navigation.navigate('Analyzing', { 
        image, 
        type: finalType, 
        selectedGenre: finalSelectedGenre,
        customRequest: finalCustomRequest,
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
    setSelectedGenre(null);
    setCustomRequest('');
  };

  const handleGenrePress = (genreId: string) => {
    triggerHaptic('light');
    setType('genre');
    setSelectedGenre(genreId === selectedGenre ? null : genreId);
    // Clear custom request when selecting a genre
    if (genreId === selectedGenre) {
      setCustomRequest('');
    } else {
      setCustomRequest('');
    }
  };

  const handleCustomRequestChange = (text: string) => {
    setCustomRequest(text);
    // If custom request is entered, set type to genre and clear selected genre
    if (text.trim()) {
      setType('genre');
      setSelectedGenre(null);
    }
  };

  const handleBack = () => {
    triggerHaptic('light');
    (navigation as any).goBack();
  };

  // Extract filename from image URI
  const getImageFilename = () => {
    if (!image) return 'image.jpg';
    const parts = image.split('/');
    const filename = parts[parts.length - 1];
    return filename.length > 20 ? filename.substring(0, 20) + '...' : filename;
  };

  const imageAspectRatio = 3 / 4.2;
  const imageHeight = width * imageAspectRatio;

  return (
    <View style={styles.container}>
      {/* Background blur effects */}
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
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
            <Text style={styles.headerTitle}>
              Vibe Analysis
            </Text>
            <View style={{ width: 40 }} /> {/* Spacer to balance header */}
          </View>

          {/* Main Content - Image */}
          <View style={styles.mainContent}>
            <View style={[styles.imageWrapper, { height: imageHeight }]}>
              {/* Gradient border */}
              <View style={styles.imageBorderGradient}>
                <LinearGradient
                  colors={[DesignColors.primary + '40', 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.imageBorderInner}>
                  <View style={styles.imageContainer}>
                    {image && image.trim() ? (
                      <Image 
                        source={{ uri: image }} 
                        style={styles.image}
                      />
                    ) : null}
                    
                    {/* Gradient overlay - simplified when expanded */}
              <LinearGradient
                      colors={[DesignColors.backgroundDark + 'E6', 'transparent', 'transparent']}
                      start={{ x: 0, y: 1 }}
                      end={{ x: 0, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />

                    {/* Bottom info */}
                    <View style={styles.imageBottomInfo}>
                      <View style={styles.neuralScan}>
                        <Animated.View 
                          style={[
                            styles.pulseDot,
                            { opacity: pulseDotAnim },
                          ]} 
                        />
                        <Text style={styles.neuralScanText}>Neural Scan Active</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </Animated.View>
      </SafeAreaView>

      {/* Bottom Sheet - Draggable */}
              <Animated.View
                style={[
          styles.bottomSheet,
          {
            transform: [{ translateY: sheetTranslateY }],
            height: EXPANDED_HEIGHT,
          },
        ]}
      >
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={['rgba(15, 5, 6, 0.85)', 'rgba(15, 5, 6, 0.9)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        
        {/* Drag handle - draggable area */}
        <View 
          style={styles.dragHandleContainer}
          {...panResponder.panHandlers}
        >
          <View style={styles.dragHandle} />
          {/* Expanded invisible touch area for easier dragging */}
          <View style={styles.dragTouchArea} />
        </View>

        <ScrollView
          style={styles.bottomSheetScrollView}
          contentContainerStyle={styles.bottomSheetContentWrapper}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled={true}
          scrollEnabled={true}
          bounces={true}
        >
          {/* Surprise Me Card */}
          <TouchableOpacity
            style={[
              styles.surpriseCard,
              type === 'surprise' && styles.surpriseCardSelected
            ]}
            onPress={handleSurprisePress}
            activeOpacity={0.9}
          >
            <View style={styles.surpriseContent}>
              <View style={styles.surpriseIcon}>
                <MaterialCommunityIcons 
                  name="brain" 
                  size={20} 
                  color={type === 'surprise' ? DesignColors.primary : 'rgba(255, 255, 255, 0.6)'} 
                />
              </View>
              <View style={styles.surpriseTextContainer}>
                <Text style={[
                  styles.surpriseTitle,
                  type === 'surprise' && styles.surpriseTitleSelected
                ]}>
                  Surprise Me
                    </Text>
                <Text style={[
                  styles.surpriseSubtitle,
                  type === 'surprise' && styles.surpriseSubtitleSelected
                ]}>
                  {(() => {
                    if (type === 'surprise') {
                      return 'AI Auto-Selection';
                    }
                    if (customRequest && customRequest.trim()) {
                      const truncated = customRequest.trim();
                      return `Custom: ${truncated.substring(0, 30)}${truncated.length > 30 ? '...' : ''}`;
                    }
                    if (selectedGenre) {
                      const genre = genreOptions.find(g => g.id === selectedGenre);
                      return `Selected: ${genre?.name || 'Custom'}`;
                    }
                    return 'AI Auto-Selection';
                  })()}
                </Text>
              </View>
                  </View>
            <View style={[
              styles.checkCircle,
              type === 'surprise' && styles.checkCircleSelected
            ]}>
              {type === 'surprise' && (
                <MaterialCommunityIcons name="check" size={12} color="#FFFFFF" />
              )}
            </View>
                </TouchableOpacity>

          {/* Manual Override Section */}
          <View style={styles.manualOverrideSection}>
            <View style={styles.manualOverrideHeader}>
              <Text style={styles.manualOverrideLabel}>Manual Override</Text>
              <View style={styles.manualOverrideLine} />
            </View>

            {/* Custom Request Text Field */}
            <View style={styles.customRequestContainer}>
              <View style={[
                styles.customRequestWrapper,
                {
                  borderColor: customRequest ? DesignColors.primary : 'rgba(255, 255, 255, 0.25)',
                  borderWidth: customRequest ? 2 : 1,
                  backgroundColor: customRequest ? DesignColors.primary + '15' : 'rgba(255, 255, 255, 0.03)',
                }
              ]}>
                <MaterialCommunityIcons 
                  name="text-box-outline" 
                  size={20} 
                  color={customRequest ? DesignColors.primary : 'rgba(255, 255, 255, 0.6)'} 
                  style={styles.customRequestIcon}
                />
                <TextInput
                  placeholder="e.g. Moody, 50 cent, 80s music, UK Rap"
                  placeholderTextColor="rgba(255, 255, 255, 0.5)"
                  value={customRequest}
                  onChangeText={handleCustomRequestChange}
                  style={styles.customRequestInput}
                  multiline
                  numberOfLines={2}
                  selectionColor={DesignColors.primary}
                  textAlignVertical="top"
                />
              </View>
            </View>

            {/* Genre Grid - 4 columns */}
            <View style={styles.genreGrid}>
              {genreOptions.map((genre) => {
                const isSelected = selectedGenre === genre.id;
                return (
                  <TouchableOpacity
                    key={genre.id}
                    style={styles.genreGridItem}
                    onPress={() => handleGenrePress(genre.id)}
                    activeOpacity={0.9}
                  >
                    <View style={[
                      styles.genreCircle,
                      isSelected && styles.genreCircleSelected
                    ]}>
                      <MaterialCommunityIcons
                        name={genre.icon as any}
                        size={32}
                        color={isSelected ? DesignColors.primary : 'rgba(255, 255, 255, 0.4)'}
                      />
                    </View>
                    <Text style={[
                      styles.genreGridLabel,
                      isSelected && styles.genreGridLabelSelected
                    ]}>
                      {genre.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </Animated.View>

      {/* Start Analysis Button - Moves with bottom sheet */}
      <Animated.View 
        style={[
          styles.startButtonContainer,
          {
            // Button position: moves with sheet
            // When expanded (translateY = -maxY): button at bottom of expanded panel
            // When collapsed (translateY = initialOffset): button above nav bar
            bottom: sheetTranslateY.interpolate({
              inputRange: [-maxY, initialOffset],
              outputRange: [
                90 + Spacing.md, // Expanded: bottom of expanded panel (above nav bar with padding)
                110 // Collapsed: above nav bar
              ],
              extrapolate: 'clamp',
            }),
          }
        ]}
      >
        <TouchableOpacity
          style={styles.startButton}
          onPress={handleStartAnalysis}
          disabled={loading}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={[DesignColors.primary, '#E60035']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.startButtonGradient}
          >
            <Text style={styles.startButtonText}>
              {loading ? 'Processing...' : 'Start Analysis'}
            </Text>
            <MaterialCommunityIcons name="auto-fix" size={20} color="#FFFFFF" />
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: DesignColors.backgroundDark,
    position: 'relative',
    zIndex: 1,
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
    zIndex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
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
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: 'rgba(255, 255, 255, 0.9)',
    textShadowColor: DesignColors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  headerTitleExpanded: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  mainContent: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: Spacing.xl,
    paddingBottom: COLLAPSED_HEIGHT + Spacing.lg, // Add padding so image sits above collapsed panel
    paddingHorizontal: Spacing.md,
  },
  imageWrapper: {
    width: '100%',
    maxWidth: width * 0.9,
  },
  imageBorderGradient: {
    borderRadius: 40,
    padding: 1,
    overflow: 'hidden',
    ...Shadows.prominent,
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  imageBorderInner: {
    width: '100%',
    height: '100%',
    borderRadius: 38,
    overflow: 'hidden',
    backgroundColor: DesignColors.backgroundDark,
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  cornerTopLeft: {
    position: 'absolute',
    top: 24,
    left: 24,
    width: 24,
    height: 24,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: DesignColors.primary,
    zIndex: 20,
  },
  cornerBottomRight: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 24,
    height: 24,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: DesignColors.primary,
    zIndex: 20,
  },
  imageBottomInfo: {
    position: 'absolute',
    bottom: Spacing.xl,
    left: Spacing.xl,
    right: Spacing.xl,
  },
  neuralScan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: DesignColors.primary,
  },
  neuralScanText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: DesignColors.primary,
  },
  imageFilename: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  matchBadge: {
    position: 'absolute',
    top: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: DesignColors.primary + '20',
    borderWidth: 1,
    borderColor: DesignColors.primary + '40',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 9999,
  },
  matchBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: '#FFFFFF',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: -(EXPANDED_HEIGHT - COLLAPSED_HEIGHT), // Base position
    left: 0,
    right: 0,
    borderTopLeftRadius: 48,
    borderTopRightRadius: 48,
    borderTopWidth: 1,
    borderTopColor: DesignColors.primary + '30',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.6,
    shadowRadius: 40,
    elevation: 20,
    zIndex: 50,
  },
  dragHandleContainer: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingVertical: Spacing.md + 8, // Increased vertical padding for larger touch area
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60, // Minimum touch area height for easier dragging
  },
  dragHandle: {
    width: 48,
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 3,
    marginBottom: Spacing.xs,
  },
  dragTouchArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Invisible expanded touch area - makes entire container draggable
  },
  bottomSheetScrollView: {
    flex: 1,
  },
  bottomSheetContentWrapper: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm, // Reduced since drag handle container now has more padding
    paddingBottom: 150, // Extra padding to allow scrolling past all genres and button
    gap: Spacing.xl,
    flexGrow: 1, // Allow content to grow beyond viewport
  },
  surpriseCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  surpriseCardSelected: {
    borderColor: DesignColors.primary + '40',
  },
  surpriseContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  surpriseIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: DesignColors.primary + '20',
    borderWidth: 1,
    borderColor: DesignColors.primary + '30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  surpriseTextContainer: {
    flex: 1,
  },
  surpriseTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 2,
  },
  surpriseTitleSelected: {
    color: DesignColors.primary,
  },
  surpriseSubtitle: {
    fontSize: 10,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  surpriseSubtitleSelected: {
    color: DesignColors.primary + 'CC',
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkCircleSelected: {
    backgroundColor: DesignColors.primary,
    borderColor: DesignColors.primary,
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 10,
  },
  manualOverrideSection: {
    gap: Spacing.md,
  },
  customRequestContainer: {
    marginBottom: Spacing.md,
  },
  customRequestWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 68,
  },
  customRequestIcon: {
    marginRight: Spacing.sm,
    marginTop: 2,
  },
  customRequestInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    paddingVertical: 0,
    minHeight: 40,
    lineHeight: 20,
  },
  manualOverrideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  manualOverrideLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: DesignColors.primary,
  },
  manualOverrideLine: {
    flex: 1,
    height: 1,
    backgroundColor: DesignColors.primary + '30',
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  genreGridItem: {
    alignItems: 'center',
    gap: 8,
    width: (width - Spacing.lg * 2 - Spacing.md * 3) / 4, // 4 columns with gaps
  },
  genreCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  genreCircleSelected: {
    backgroundColor: DesignColors.primary + '20',
    borderWidth: 2,
    borderColor: DesignColors.primary,
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
    elevation: 15,
  },
  genreGridLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
  },
  genreGridLabelSelected: {
    color: DesignColors.primary,
    fontWeight: '900',
  },
  startButtonContainer: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 100, // Above the bottom sheet
    // bottom is animated based on sheet position (see component)
  },
  startButton: {
    borderRadius: 9999,
    overflow: 'hidden',
    shadowColor: DesignColors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 15,
  },
  startButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg - 2,
    gap: Spacing.sm,
  },
  startButtonText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: '#FFFFFF',
  },
});

export default RecommendationTypeScreen;
