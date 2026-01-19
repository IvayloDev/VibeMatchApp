import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Animated, Dimensions, Alert, TouchableOpacity, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { Spacing, BorderRadius, Shadows } from '../../../lib/designSystem';
import { triggerHaptic } from '../../../lib/utils/haptics';
import { deductCredits, refundCredits } from '../../../lib/credits';

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

type AnalyzingParams = { image: string; selectedGenre?: string; customRequest?: string; userId?: string };
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

async function uploadImageAndGetSignedUrl(localUri: string, userId: string) {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const reader = new FileReader();
  
  return new Promise<{ filePath: string; signedUrl: string }>((resolve, reject) => {
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const file = base64.split(',')[1];
        const filePath = `${userId}/${Date.now()}.jpg`;
        const byteArray = Uint8Array.from(atob(file), c => c.charCodeAt(0));

        console.log('📤 [Upload] Attempting to upload file to path:', filePath);
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('images')
          .upload(filePath, byteArray, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadError) {
          console.error('❌ [Upload] Upload failed:', uploadError);
          console.error('❌ [Upload] File path:', filePath);
          throw uploadError;
        }

        console.log('✅ [Upload] Upload successful. Data:', uploadData);
        
        // Use the actual path returned from upload (in case it was modified)
        const actualFilePath = uploadData?.path || filePath;
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
  const { image, selectedGenre, customRequest, userId } = (route.params || {}) as AnalyzingParams;
  
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

    const analyzePhoto = async () => {
      let uploadedFilePath: string | null = null;
      
      try {
        setProgress(5);
        const { filePath, signedUrl } = await uploadImageAndGetSignedUrl(image, userId || 'anonymous');
        uploadedFilePath = filePath;
        setProgress(25);

        const hasCustomRequest = !!(customRequest && customRequest.trim());
        const hasGenre = !!selectedGenre && !hasCustomRequest;
        
        const payload = { 
          imageUrl: signedUrl, 
          genre: hasCustomRequest ? undefined : selectedGenre,
          customRequest: hasCustomRequest ? customRequest.trim() : undefined,
          hasCustomRequest: hasCustomRequest,
          hasGenre: hasGenre
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

        const response = await fetch('https://mebjzwwtuzwcrwugxjvu.supabase.co/functions/v1/recommend-songs', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        
        clearInterval(apiProgressInterval);
        setProgress(85);
        
        const data = await response.json();
        setProgress(90);

        if (!response.ok || data.error || !data.songs) {
          setProgress(100);
          Animated.timing(progressAnim, {
            toValue: 100,
            duration: 500,
            useNativeDriver: false,
          }).start(() => {
            setTimeout(() => {
              Alert.alert(
                'No Matches Found',
                data.message || 'Sorry, we couldn\'t find any matching songs for your request. Your credit has not been charged.',
                [{ text: 'OK', onPress: () => (navigation as any).navigate('Dashboard') }]
              );
            }, 300);
          });
          return;
        }

        const songs = data.songs || [];
        const hasValidResponse = Array.isArray(songs) && songs.length >= 3;

        if (!hasValidResponse) {
          setProgress(100);
          Animated.timing(progressAnim, {
            toValue: 100,
            duration: 500,
            useNativeDriver: false,
          }).start(() => {
            setTimeout(() => {
              Alert.alert(
                'No Matches Found',
                'Sorry, we couldn\'t find any matching songs for your request. Your credit has not been charged.',
                [{ text: 'OK', onPress: () => (navigation as any).navigate('Dashboard') }]
              );
            }, 300);
          });
          return;
        }

        const deductionSuccess = await deductCredits(1);
        if (deductionSuccess) {
          console.log('✅ Credit deducted successfully');
        }

        if (currentUserId && filePath && songs) {
          await supabase.from('history').insert([
            { user_id: currentUserId, image_url: filePath, songs: songs },
          ]);
        }
        setProgress(95);

        setProgress(100);
        
        Animated.timing(progressAnim, {
          toValue: 100,
          duration: 500,
          useNativeDriver: false,
        }).start(() => {
          setTimeout(() => {
            (navigation as any).navigate('History', { 
              screen: 'HistoryResults',
              params: { 
                image: signedUrl, 
                songs: songs, 
                imagePath: uploadedFilePath ?? undefined 
              }
            });
          }, 300);
        });
      } catch (error) {
        console.log('Error during analysis:', error);
        setProgress(100);
        Animated.timing(progressAnim, {
          toValue: 100,
          duration: 500,
          useNativeDriver: false,
        }).start(() => {
          setTimeout(() => {
            Alert.alert(
              'Analysis Failed',
              'Sorry, we encountered an error while analyzing your photo. Your credit has not been charged. Please try again.',
              [{ text: 'OK', onPress: () => (navigation as any).navigate('Dashboard') }]
            );
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
  }, [navigation, image, selectedGenre, customRequest, userId]);

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
        <Image source={{ uri: image }} style={styles.backgroundImage} blurRadius={80} />
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
              <Text style={styles.headerSubtitle}>VibeMatch AI</Text>
              <Text style={styles.headerMainTitle}>Analysis</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          {/* Main Content */}
          <View style={styles.mainContent}>
            {/* Image with scanning line and corner boxes */}
            <View style={[styles.imageContainer, { width: imageSize, height: imageSize * 1.25 }]}>
              <Image source={{ uri: image }} style={styles.image} />
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
              <Text style={styles.subtitle}>Reading the mood and atmosphere</Text>
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
