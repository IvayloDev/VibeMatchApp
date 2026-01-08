import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Animated, Dimensions, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { Colors, Typography, Spacing, BorderRadius, Shadows, Layout } from '../../../lib/designSystem';
import { FloatingCard } from '../../../lib/components/FloatingCard';
import { triggerHaptic } from '../../../lib/utils/haptics';
import { deductCredits, refundCredits } from '../../../lib/credits';

const { width } = Dimensions.get('window');

type AnalyzingParams = { image: string; selectedGenre?: string; customRequest?: string; userId?: string };
type RootStackParamList = {
  Results: { image: string; songs: any[]; imagePath?: string };
  Payment: undefined;
  // ...other routes
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
  // Convert local URI to base64
  const response = await fetch(localUri);
  const blob = await response.blob();
  const reader = new FileReader();
  
  return new Promise<{ filePath: string; signedUrl: string }>((resolve, reject) => {
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const file = base64.split(',')[1]; // Remove data:image/jpeg;base64, prefix
        
        // Create unique file path
        const filePath = `${userId}/${Date.now()}.jpg`;

        // Convert base64 to Uint8Array
        const byteArray = Uint8Array.from(atob(file), c => c.charCodeAt(0));

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(filePath, byteArray, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadError) throw uploadError;

        // Get a signed URL (valid for 1 hour)
        const { data, error: signedUrlError } = await supabase.storage
          .from('images')
          .createSignedUrl(filePath, 60 * 60);

        if (signedUrlError) {
          console.error('Error creating signed URL:', signedUrlError);
          console.error('File path:', filePath);
          // Check if it's a JSON parse error (API returned HTML)
          if (signedUrlError.message?.includes('JSON Parse error') || signedUrlError.message?.includes('Unexpected character')) {
            console.error('⚠️ Storage API returned HTML instead of JSON - likely authentication or permissions issue');
            // Try to refresh session
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session) {
              throw new Error('Authentication error. Please sign in again.');
            }
            // Retry once after session refresh
            const { data: retryData, error: retryError } = await supabase.storage
              .from('images')
              .createSignedUrl(filePath, 60 * 60);
            if (retryError) throw retryError;
            if (!retryData?.signedUrl) throw new Error('Failed to get signed URL after retry');
            resolve({ filePath, signedUrl: retryData.signedUrl });
            return;
          }
          throw signedUrlError;
        }

        if (!data || !data.signedUrl) {
          throw new Error('No signed URL returned from storage');
        }

        resolve({ filePath, signedUrl: data.signedUrl });
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
  
  const [statusIndex, setStatusIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState(30);
  const [statusMessages] = useState([
    'Analyzing your photo...',
    'Detecting mood and style...',
    'Finding perfect songs...',
    'Almost ready...',
  ]);
  
  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const statusOpacity = useRef(new Animated.Value(1)).current;
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  // Hide tab bar when this screen is focused
  useFocusEffect(
    React.useCallback(() => {
      const parent = navigation.getParent();
      if (parent) {
        parent.setOptions({
          tabBarStyle: { display: 'none' }
        });
      }

      return () => {
        if (parent) {
          parent.setOptions({
            tabBarStyle: { display: 'flex' }
          });
        }
      };
    }, [navigation])
  );

  useEffect(() => {
    // Log what we received (only once on mount)
    console.log('📥 [AnalyzingScreen] Received params:', {
      hasImage: !!image,
      selectedGenre: selectedGenre || 'N/A',
      customRequest: customRequest || 'N/A',
      userId: userId || 'N/A',
    });
    
    // Initial fade in
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

    // Start pulsing animation
    const startPulsing = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      ).start();
    };

    // Start glow animation
    const startGlow = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 0.7,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.3,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    };

    // Start rotation animation
    const startRotation = () => {
      Animated.loop(
        Animated.timing(rotationAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        })
      ).start();
    };
    
    startPulsing();
    startGlow();
    startRotation();
    
    // Update estimated time (will be adjusted based on actual progress)
    const timeInterval = setInterval(() => {
      setEstimatedTime((prev) => Math.max(0, prev - 1));
    }, 1000);
    
    // Status message rotation
    const statusInterval = setInterval(() => {
      Animated.sequence([
        Animated.timing(statusOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(statusOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
      
      setStatusIndex((prev) => (prev + 1) % statusMessages.length);
    }, 2000);

    const analyzePhoto = async () => {
      let uploadedFilePath: string | null = null;
      const startTime = Date.now();
      
      try {
        // Stage 1: Upload image (0-25%)
        setProgress(5);
        setStatusIndex(0); // "Analyzing your photo..."
        
        const uploadStartTime = Date.now();
        const { filePath, signedUrl } = await uploadImageAndGetSignedUrl(image, userId || 'anonymous');
        uploadedFilePath = filePath;
        
        const uploadTime = Date.now() - uploadStartTime;
        setProgress(25);
        setStatusIndex(1); // "Detecting mood and style..."

        // Stage 2: Get session (25-30%)
        // If customRequest is provided, it overrides the genre
        // Build payload with flags that the Edge Function expects
        const hasCustomRequest = !!(customRequest && customRequest.trim());
        const hasGenre = !!selectedGenre && !hasCustomRequest; // Only true if no customRequest
        
        const payload = { 
          imageUrl: signedUrl, 
          genre: hasCustomRequest ? undefined : selectedGenre,
          customRequest: hasCustomRequest ? customRequest.trim() : undefined,
          hasCustomRequest: hasCustomRequest,
          hasGenre: hasGenre
        };
        
        // Log the payload being sent to the API
        console.log('📤 [API Request] Sending payload to recommend-songs:', JSON.stringify(payload, null, 2));
        console.log('📤 [API Request] Details:', {
          imageUrl: signedUrl ? `${signedUrl.substring(0, 50)}...` : 'N/A',
          genre: payload.genre || 'N/A',
          customRequest: payload.customRequest || 'N/A',
          hasCustomRequest: payload.hasCustomRequest,
          hasGenre: payload.hasGenre,
        });
        
        // Get session and access token for API call
        let accessToken: string | undefined;
        let currentUserId: string | undefined;
        
        try {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) {
            console.warn('⚠️ Session error (continuing without auth):', sessionError.message);
          } else if (session?.access_token) {
            accessToken = session.access_token;
            currentUserId = session.user?.id;
            console.log('✅ Session retrieved, access token available');
          } else {
            console.log('ℹ️ No session available (guest user)');
          }
        } catch (error) {
          console.warn('⚠️ Error getting session (continuing without auth):', error);
        }
        
        setProgress(30);

        // Stage 3: Call API (30-85%)
        setStatusIndex(2); // "Finding perfect songs..."
        
        // Estimate API call time based on upload time (faster estimation)
        const estimatedApiTime = Math.max(uploadTime * 2, 6000); // At least 6 seconds (reduced from 10)
        const apiStartTime = Date.now();
        
        // Simulate gradual progress during API call (faster updates)
        const apiProgressInterval = setInterval(() => {
          const elapsed = Date.now() - apiStartTime;
          const progressPercent = Math.min(30 + (elapsed / estimatedApiTime) * 55, 85);
          setProgress(progressPercent);
          
          // Update estimated time based on progress
          const remainingTime = Math.ceil((estimatedApiTime - elapsed) / 1000);
          if (remainingTime > 0) {
            setEstimatedTime(remainingTime);
          }
        }, 150); // Faster update interval (reduced from 200)

        // Build headers - always include Authorization if we have a token
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
          console.log('📤 [API Request] Including Authorization header');
        } else {
          console.log('📤 [API Request] No Authorization header (guest user)');
        }

        console.log('📤 [API Request] Making fetch request to:', 'https://mebjzwwtuzwcrwugxjvu.supabase.co/functions/v1/recommend-songs');
        const response = await fetch('https://mebjzwwtuzwcrwugxjvu.supabase.co/functions/v1/recommend-songs', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        
        console.log('📥 [API Response] Status:', response.status, response.statusText);
        
        clearInterval(apiProgressInterval);
        setProgress(85);
        
        const data = await response.json();
        console.log('📥 [API Response] Received data:', {
          hasSongs: !!data.songs,
          songCount: data.songs?.length || 0,
          songs: data.songs?.slice(0, 3).map((s: any) => ({ title: s.title, artist: s.artist })) || [],
          error: data.error || null,
          message: data.message || null,
          details: data.details || null,
          rawPreview: data.rawPreview || null,
        });
        setProgress(90);
        setStatusIndex(3); // "Almost ready..."

        // Check if API returned an error or no songs
        if (!response.ok || data.error || !data.songs) {
          // No matches found - don't deduct credit, show error message
          setProgress(100);
          setEstimatedTime(0);
          
          Animated.timing(progressAnim, {
            toValue: 100,
            duration: 500,
            useNativeDriver: false,
          }).start(() => {
            setTimeout(() => {
              Alert.alert(
                'No Matches Found',
                data.message || 'Sorry, we couldn\'t find any matching songs for your request. Your credit has not been charged.',
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      // Navigate back to Dashboard
                      (navigation as any).navigate('Dashboard');
                    }
                  }
                ]
              );
            }, 300);
          });
          return;
        }

        // Check if we got 3 songs - only then deduct credit
        const songs = data.songs || [];
        const hasValidResponse = Array.isArray(songs) && songs.length >= 3;

        if (!hasValidResponse) {
          // No matches found - don't deduct credit, show error message
          setProgress(100);
          setEstimatedTime(0);
          
          Animated.timing(progressAnim, {
            toValue: 100,
            duration: 500,
            useNativeDriver: false,
          }).start(() => {
            setTimeout(() => {
              Alert.alert(
                'No Matches Found',
                'Sorry, we couldn\'t find any matching songs for your request. Your credit has not been charged.',
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      // Navigate back to Dashboard
                      (navigation as any).navigate('Dashboard');
                    }
                  }
                ]
              );
            }, 300);
          });
          return;
        }

        // We have 3+ songs - deduct 1 credit
        const deductionSuccess = await deductCredits(1);
        if (!deductionSuccess) {
          console.warn('⚠️ Failed to deduct credit, but proceeding with results');
        } else {
          console.log('✅ Credit deducted successfully for successful analysis');
        }

        // Stage 4: Save to history (90-95%)
        if (currentUserId && filePath && songs) {
          await supabase.from('history').insert([
            {
              user_id: currentUserId,
              image_url: filePath,
              songs: songs,
            },
          ]);
        }
        setProgress(95);

        // Stage 5: Complete (95-100%)
        const totalTime = Date.now() - startTime;
        setEstimatedTime(0);
        setProgress(100);
        
        Animated.timing(progressAnim, {
          toValue: 100,
          duration: 500,
          useNativeDriver: false,
        }).start(() => {
          // Small delay to show completion
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
        // On error, don't deduct credit - show error message
        setProgress(100);
        setEstimatedTime(0);
        
        Animated.timing(progressAnim, {
          toValue: 100,
          duration: 500,
          useNativeDriver: false,
        }).start(() => {
          setTimeout(() => {
            Alert.alert(
              'Analysis Failed',
              'Sorry, we encountered an error while analyzing your photo. Your credit has not been charged. Please try again.',
              [
                {
                  text: 'OK',
                  onPress: () => {
                    // Navigate back to Dashboard
                    (navigation as any).navigate('Dashboard');
                  }
                }
              ]
            );
          }, 300);
        });
      }
    };

    analyzePhoto();

    return () => {
      clearInterval(timeInterval);
      clearInterval(statusInterval);
    };
  }, [navigation, image, selectedGenre, customRequest, userId]);

  // Animate progress bar
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const rotation = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Calculate responsive sizes
  const imageSize = Math.min(width * 0.65, 320);
  const sectionSize = Math.min(width * 0.75, 360);
  const glowSize = Math.min(width * 0.7, 340);
  const ringRadius = sectionSize / 2;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Animated background gradient */}
      <LinearGradient
        colors={[Colors.accent.blue + '15', Colors.accent.coral + '10', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View 
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Image Container with Effects */}
        <View style={[styles.imageSection, { width: sectionSize, height: sectionSize }]}>
          {/* Outer rotating ring */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                width: sectionSize,
                height: sectionSize,
                borderRadius: ringRadius,
                transform: [{ rotate: rotation }],
              }
            ]}
          >
            <LinearGradient
              colors={[Colors.accent.blue + '60', Colors.accent.coral + '40', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: ringRadius,
                borderWidth: 3,
                borderColor: 'transparent',
              }}
            />
          </Animated.View>

          {/* Glow effect */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                width: glowSize,
                height: glowSize,
                borderRadius: glowSize / 2,
                opacity: glowAnim,
                transform: [{ scale: pulseAnim }],
              }
            ]}
          >
            <LinearGradient
              colors={[Colors.accent.blue + '30', Colors.accent.coral + '20', 'transparent']}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: glowSize / 2,
              }}
            />
          </Animated.View>

          {/* Image */}
          <Animated.View 
            style={[
              {
                width: imageSize,
                height: imageSize,
                borderRadius: BorderRadius.xl,
                overflow: 'hidden',
                ...Shadows.prominent,
                zIndex: 10,
                transform: [{ scale: pulseAnim }],
              }
            ]}
          >
            <Image source={{ uri: image }} style={styles.image} />
            <BlurView intensity={15} style={styles.imageBlur} />
          </Animated.View>

          {/* Inner rotating dots */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                width: glowSize,
                height: glowSize,
                justifyContent: 'center',
                alignItems: 'center',
                transform: [{ rotate: rotation }],
              }
            ]}
          >
            <View style={styles.dot1} />
            <View style={styles.dot2} />
            <View style={styles.dot3} />
          </Animated.View>
        </View>

        {/* Progress Card */}
        <FloatingCard style={styles.progressCard}>
          <LinearGradient
            colors={[Colors.accent.blue + '20', Colors.accent.coral + '15']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardGradient}
          />
          
          <View style={styles.progressContent}>
            {/* Status Message */}
            <Animated.View style={[styles.statusContainer, { opacity: statusOpacity }]}>
              <MaterialCommunityIcons 
                name="music-note" 
                size={20} 
                color={Colors.accent.blue} 
                style={styles.statusIcon}
              />
              <Text style={styles.statusText}>{statusMessages[statusIndex]}</Text>
            </Animated.View>

            {/* Progress Bar */}
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
                    }
                  ]}
                >
                  <LinearGradient
                    colors={[Colors.accent.blue, Colors.accent.coral]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              </View>
            </View>

            {/* Progress Info */}
            <View style={styles.progressInfo}>
              <View style={styles.progressStat}>
                <Text style={styles.progressLabel}>Progress</Text>
                <Text style={styles.progressValue}>{Math.round(progress)}%</Text>
              </View>
              {estimatedTime > 0 && (
                <View style={styles.progressStat}>
                  <MaterialCommunityIcons 
                    name="clock-outline" 
                    size={14} 
                    color={Colors.textSecondary} 
                  />
                  <Text style={styles.timeText}>~{estimatedTime}s</Text>
                </View>
              )}
            </View>
          </View>
        </FloatingCard>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xl,
  },
  imageSection: {
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xl,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.2,
  },
  innerRing: {
    position: 'absolute',
    width: Math.min(width * 0.7, 340),
    height: Math.min(width * 0.7, 340),
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot1: {
    position: 'absolute',
    top: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.accent.blue,
    ...Shadows.card,
  },
  dot2: {
    position: 'absolute',
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.accent.coral,
    ...Shadows.card,
  },
  dot3: {
    position: 'absolute',
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.accent.blue,
    ...Shadows.card,
  },
  progressCard: {
    width: '100%',
    maxWidth: width - Spacing.lg * 2,
    padding: Spacing.lg,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  progressContent: {
    zIndex: 1,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  statusIcon: {
    marginRight: 4,
  },
  statusText: {
    ...Typography.heading3,
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  progressBarContainer: {
    marginBottom: Spacing.md,
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: BorderRadius.round,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: BorderRadius.round,
    ...Shadows.card,
  },
  progressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  progressLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 12,
    marginRight: Spacing.xs,
  },
  progressValue: {
    ...Typography.heading3,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.accent.blue,
  },
  timeText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 12,
  },
});

export default AnalyzingScreen;