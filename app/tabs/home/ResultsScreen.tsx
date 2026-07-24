import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, TouchableOpacity, Alert, Animated, Dimensions, Modal, ActivityIndicator, ScrollView } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getImageSignedUrl } from '../../../lib/supabase';
import { supabase } from '../../../lib/supabase';
import { Colors, Typography, Spacing, Layout, BorderRadius } from '../../../lib/designSystem';
import { triggerHaptic } from '../../../lib/utils/haptics';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { maybeRequestReview } from '../../../lib/reviewPrompt';
import { startLaunchOffer } from '../../../lib/launchOffer';
import { trackEvent } from '../../../lib/posthog';
import { TrackPreviewProvider } from '../../../lib/trackPreview';
import { TrackPreviewButton } from '../../../lib/components/TrackPreviewButton';

const { width, height } = Dimensions.get('window');

type Song = {
  title: string;
  artist: string;
  reason: string;
  spotify_url?: string;
  album_cover?: string; // Album cover image URL
  preview_url?: string | null; // 30s clip; may be null (client falls back to iTunes)
};

type ResultsParams = {
  image: string; // This can be either a file path or signed URL
  songs: Song[];
  historyItemId?: string; // Optional history item ID for deletion
  imagePath?: string; // Original storage path for refreshing signed URLs
  fromOnboarding?: boolean;
  fromFreshMatch?: boolean; // True only on a live new match (not history re-view)
};

type TabParamList = {
  Home: undefined;
  History: undefined;
  Profile: undefined;
};

type HistoryStackParamList = {
  History: undefined;
  HistoryResults: ResultsParams;
};

type ResultsNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<any>,
  CompositeNavigationProp<
    BottomTabNavigationProp<TabParamList>,
    NativeStackNavigationProp<HistoryStackParamList>
  >
>;

const ResultsScreen = () => {
  const route = useRoute();
  const navigation = useNavigation<ResultsNavigationProp>();
  const insets = useSafeAreaInsets();
  const { image, songs = [], historyItemId, imagePath, fromOnboarding, fromFreshMatch } = (route.params || {}) as ResultsParams;
  const [imageUrl, setImageUrl] = useState<string>(image);
  // The reveal moment is now the AnalyzingScreen "Match found" animation, so we
  // land straight on the results (no in-screen 5s reveal overlay).
  const [showAnimation, setShowAnimation] = useState(false);
  const [showMatchCards, setShowMatchCards] = useState(false);
  const [showContinueButton, setShowContinueButton] = useState(false);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [modalImageSize, setModalImageSize] = useState<{ width: number; height: number } | null>(null);
  
  // Animation values
  const matchTextOpacity = useRef(new Animated.Value(0)).current;
  const matchTextScale = useRef(new Animated.Value(0.3)).current;
  const matchTextRotation = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.5)).current;
  const ring1Scale = useRef(new Animated.Value(0)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale = useRef(new Animated.Value(0)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const ring3Scale = useRef(new Animated.Value(0)).current;
  const ring3Opacity = useRef(new Animated.Value(0)).current;
  // Removed particle animations to avoid React Native tracking errors
  // Using simpler visual effects instead
  
  // Confetti animation
  const confettiScale = useRef(new Animated.Value(0)).current;
  const confettiRotation = useRef(new Animated.Value(0)).current;
  // Song card animation
  const songCardOpacity = useRef(new Animated.Value(0)).current;
  const songCardTranslateY = useRef(new Animated.Value(50)).current;
  const songCardScale = useRef(new Animated.Value(0.9)).current;
  // Play button animation
  const playButtonScale = useRef(new Animated.Value(0)).current;
  const playButtonOpacity = useRef(new Animated.Value(0)).current;
  const backgroundPulse = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(showAnimation ? 1 : 0)).current;
  const imageScale = useRef(new Animated.Value(showAnimation ? 1.5 : 1)).current;
  const imagePosition = useRef(new Animated.ValueXY(showAnimation ? { x: 0, y: 0 } : { x: 0, y: 0 })).current;
  const contentOpacity = useRef(new Animated.Value(showAnimation ? 0 : 1)).current;
  const mainSongOpacity = useRef(new Animated.Value(showAnimation ? 0 : 1)).current;
  const alternativesOpacity = useRef(new Animated.Value(showAnimation ? 0 : 1)).current;
  // Entrance animation for the redesigned results screen.
  const heroEnter = useRef(new Animated.Value(0)).current;
  const listEnter = useRef(new Animated.Value(0)).current;
  
  // Staggered animations for alternative songs (max 2 alternatives)
  const alternativeAnimations = useRef([
    { opacity: new Animated.Value(0), translateX: new Animated.Value(50) },
    { opacity: new Animated.Value(0), translateX: new Animated.Value(50) },
  ]).current;
  
  // Tinder-style match card animations
  const userCardPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const albumCardPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const userCardRotation = useRef(new Animated.Value(0)).current;
  const albumCardRotation = useRef(new Animated.Value(0)).current;
  const userCardOpacity = useRef(new Animated.Value(0)).current;
  const albumCardOpacity = useRef(new Animated.Value(0)).current;
  const continueButtonOpacity = useRef(new Animated.Value(0)).current;

  console.log('ResultsScreen params:', { image, songsCount: songs?.length, historyItemId, showAnimation });

  const storageImagePath = imagePath || (image && !image.startsWith('http') ? image : undefined);

  // After a genuine fresh match, give the user a moment to see the result,
  // then (maybe) surface the native review sheet. Gated once-ever inside
  // maybeRequestReview(); history re-views never pass fromFreshMatch.
  useEffect(() => {
    if (!fromFreshMatch) return;
    const t = setTimeout(() => {
      maybeRequestReview();
    }, 3500);
    return () => clearTimeout(t);
  }, []);

  // Smooth entrance: hero rises + fades in, alternatives follow with a slight stagger.
  useEffect(() => {
    Animated.stagger(110, [
      Animated.timing(heroEnter, { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.timing(listEnter, { toValue: 1, duration: 520, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadImage = async () => {
      if (storageImagePath) {
        try {
          const signedUrl = await getImageSignedUrl(storageImagePath);
          if (signedUrl && isMounted) {
            setImageUrl(signedUrl);
          }
        } catch (error) {
          console.error('Error fetching signed image URL:', error);
        }
      } else {
        setImageUrl(image);
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [image, storageImagePath]);

  useEffect(() => {
    if (!imageUrl) {
      setModalImageSize(null);
      return;
    }

    Image.getSize(
      imageUrl,
      (width, height) => {
        const window = Dimensions.get('window');
        const maxWidth = Math.max(window.width - Spacing.lg * 2, 200);
        const maxHeight = Math.max(window.height - (insets.top + insets.bottom + 120), 200);

        let displayWidth = maxWidth;
        let displayHeight = (height / width) * displayWidth;

        if (displayHeight > maxHeight) {
          displayHeight = maxHeight;
          displayWidth = (width / height) * displayHeight;
        }

        setModalImageSize({ width: displayWidth, height: displayHeight });
      },
      (error) => {
        console.error('Error getting image size:', error);
        const window = Dimensions.get('window');
        setModalImageSize({
          width: Math.max(window.width - Spacing.lg * 2, 200),
          height: Math.max(window.height - (insets.top + insets.bottom + 120), 200),
        });
      }
    );
  }, [imageUrl, insets.bottom, insets.top]);

  // Animation sequence
  useEffect(() => {
    if (showAnimation && songs.length > 0) {
      // Step 1: Initial pulse and glow (delay to let screen settle)
      setTimeout(() => {
        // Background pulse animation (continuous)
        Animated.loop(
          Animated.sequence([
            Animated.timing(backgroundPulse, {
              toValue: 1,
              duration: 2000,
              useNativeDriver: true,
            }),
            Animated.timing(backgroundPulse, {
              toValue: 0,
              duration: 2000,
              useNativeDriver: true,
            }),
          ])
        ).start();

        // Glow effect
        Animated.parallel([
          Animated.timing(glowOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.spring(glowScale, {
            toValue: 1.2,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
        ]).start();

        // Rotating rings animation - seamless loop
        const createRingAnimation = (scale: Animated.Value, opacity: Animated.Value, delay: number) => {
          const animateRing = () => {
            // Reset values
            scale.setValue(0);
            opacity.setValue(0);
            
            Animated.parallel([
              Animated.timing(scale, {
                toValue: 2.5,
                duration: 2000,
                useNativeDriver: true,
              }),
              Animated.sequence([
                Animated.timing(opacity, {
                  toValue: 0.6,
                  duration: 400,
                  useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                  toValue: 0,
                  duration: 1600,
                  useNativeDriver: true,
                }),
              ]),
            ]).start(() => {
              // Loop seamlessly
              animateRing();
            });
          };
          
          setTimeout(() => {
            animateRing();
          }, delay);
        };

        createRingAnimation(ring1Scale, ring1Opacity, 0);
        createRingAnimation(ring2Scale, ring2Opacity, 666); // Stagger by 1/3 of duration
        createRingAnimation(ring3Scale, ring3Opacity, 1332); // Stagger by 2/3 of duration

        // Particle effects removed to avoid React Native tracking errors

        // Haptic feedback sequence
        triggerHaptic('success');
        setTimeout(() => triggerHaptic('medium'), 200);
        setTimeout(() => triggerHaptic('light'), 400);
      }, 300);

      // Step 2: Show "It's a Match!" text with dramatic entrance
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(matchTextOpacity, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.spring(matchTextScale, {
            toValue: 1,
            tension: 100,
            friction: 8,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(matchTextRotation, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(matchTextRotation, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
          ]),
        ]).start();

        // Continuous pulsing glow
        Animated.loop(
          Animated.sequence([
            Animated.timing(glowScale, {
              toValue: 1.3,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(glowScale, {
              toValue: 1.1,
              duration: 1000,
              useNativeDriver: true,
            }),
          ])
        ).start();

        // Animate confetti emoji
        setTimeout(() => {
          Animated.parallel([
            Animated.spring(confettiScale, {
              toValue: 1,
              tension: 80,
              friction: 6,
              useNativeDriver: true,
            }),
            Animated.sequence([
              Animated.timing(confettiRotation, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
              }),
              Animated.timing(confettiRotation, {
                toValue: -1,
                duration: 400,
                useNativeDriver: true,
              }),
              Animated.timing(confettiRotation, {
                toValue: 0,
                duration: 400,
                useNativeDriver: true,
              }),
            ]),
          ]).start();

          // Continuous bounce animation for confetti
          Animated.loop(
            Animated.sequence([
              Animated.timing(confettiScale, {
                toValue: 1.15,
                duration: 600,
                useNativeDriver: true,
              }),
              Animated.timing(confettiScale, {
                toValue: 1,
                duration: 600,
                useNativeDriver: true,
              }),
            ])
          ).start();
        }, 800);

        // Animate song card (after text appears)
        setTimeout(() => {
          Animated.parallel([
            Animated.timing(songCardOpacity, {
              toValue: 1,
              duration: 600,
              useNativeDriver: true,
            }),
            Animated.spring(songCardTranslateY, {
              toValue: 0,
              tension: 60,
              friction: 7,
              useNativeDriver: true,
            }),
            Animated.spring(songCardScale, {
              toValue: 1,
              tension: 60,
              friction: 7,
              useNativeDriver: true,
            }),
          ]).start();

          // Animate play button (after card appears)
          setTimeout(() => {
            Animated.parallel([
              Animated.spring(playButtonScale, {
                toValue: 1,
                tension: 100,
                friction: 6,
                useNativeDriver: true,
              }),
              Animated.timing(playButtonOpacity, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
              }),
            ]).start();

            // Pulse animation for play button
            Animated.loop(
              Animated.sequence([
                Animated.timing(playButtonScale, {
                  toValue: 1.1,
                  duration: 800,
                  useNativeDriver: true,
                }),
                Animated.timing(playButtonScale, {
                  toValue: 1,
                  duration: 800,
                  useNativeDriver: true,
                }),
              ])
            ).start();
          }, 300);
        }, 1200);
      }, 500);

      // Step 3: Hide match text, fade out overlay, and animate image to position (after 4.5 seconds - more time to see the song card)
      setTimeout(() => {
        Animated.parallel([
          // Hide match text and effects
          Animated.timing(matchTextOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          // Fade out the entire overlay
          Animated.timing(overlayOpacity, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
          // Move and scale image to final position
          Animated.timing(imageScale, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(imagePosition, {
            toValue: { x: 0, y: 0 },
            duration: 800,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Remove overlay from DOM after fade-out completes
          setShowAnimation(false);
        });
      }, 5000); // Extended to 5 seconds to show song card longer

      // Step 4: Show content with staggered animations (after image settles)
      setTimeout(() => {
        // Show main content
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }).start();

        // Staggered reveal of main song
        setTimeout(() => {
          Animated.timing(mainSongOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }).start();
        }, 200);

        // Staggered reveal of alternatives with slide-in
        setTimeout(() => {
          Animated.timing(alternativesOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }).start();
          
          // Animate each alternative song card individually
          alternativeAnimations.forEach((anim, index) => {
            setTimeout(() => {
              Animated.parallel([
                Animated.timing(anim.opacity, {
                  toValue: 1,
                  duration: 500,
                  useNativeDriver: true,
                }),
                Animated.spring(anim.translateX, {
                  toValue: 0,
                  tension: 50,
                  friction: 7,
                  useNativeDriver: true,
                }),
              ]).start();
            }, index * 150);
          });
        }, 500);
      }, 4500);
    } else {
      // If no animation, show alternatives immediately
      alternativeAnimations.forEach((anim) => {
        anim.opacity.setValue(1);
        anim.translateX.setValue(0);
      });
    }
  }, [showAnimation, songs.length]);

  const handleBackPress = () => {
    triggerHaptic('light');
    if (fromOnboarding) {
      (navigation as any).reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      return;
    }
    // Check if we're in HistoryResults (History stack) or Results (Home stack)
    const routeName = route.name;

    if (routeName === 'HistoryResults') {
      // If we're in HistoryResults, navigate to History list
      // This ensures we always go back to History, not Analyzing
      navigation.navigate('History', { screen: 'History' });
    } else {
      // If we're in Results (Home stack), just go back normally
      navigation.goBack();
    }
  };

  const handleStartExploring = () => {
    // Kick off the launch offer before resetting navigation
    startLaunchOffer().catch(() => {});
    trackEvent('launch_offer_started');
    handleBackPress();
  };

  const handleContinueToResults = () => {
    // Hide match cards and show main results content
    setShowMatchCards(false);
    setShowContinueButton(false);
    setShowAnimation(false);
    
    // Animate to final results state
    Animated.parallel([
      Animated.timing(imageScale, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(imagePosition, {
        toValue: { x: 0, y: 0 },
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Staggered reveal of content
      setTimeout(() => {
        Animated.timing(mainSongOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }).start();
      }, 200);

      setTimeout(() => {
        Animated.timing(alternativesOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }).start();
      }, 500);
    });
  };

  const handleImagePress = React.useCallback(() => {
    setImageModalVisible(true);

    if (storageImagePath) {
      getImageSignedUrl(storageImagePath)
        .then((refreshedUrl) => {
          if (refreshedUrl) {
            setImageUrl(refreshedUrl);
          }
        })
        .catch((error) => {
          console.error('Error refreshing image URL:', error);
        });
    }
  }, [storageImagePath]);

  const closeImageModal = () => {
    setImageModalVisible(false);
  };

  const handleDeletePress = () => {
    if (!historyItemId) {
      console.log('No historyItemId provided');
      return;
    }

    console.log('Attempting to delete history item:', historyItemId);

    Alert.alert(
      'Delete Item',
      'Are you sure you want to delete this history item? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              console.log('Deleting from Supabase with ID:', historyItemId);
              
              // Check if user is authenticated
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) {
                console.error('No active session');
                Alert.alert('Error', 'You must be logged in to delete items.');
                return;
              }

              console.log('User authenticated, user ID:', session.user.id);
              
              // First, let's check if the item exists and belongs to this user
              const { data: existingItem, error: fetchError } = await supabase
                .from('history')
                .select('id, user_id, image_url')
                .eq('id', historyItemId)
                .single();

              console.log('Existing item check:', { 
                existingItem, 
                fetchError,
                itemUserId: existingItem?.user_id,
                currentUserId: session.user.id,
                userIdsMatch: existingItem?.user_id === session.user.id 
              });

              if (fetchError || !existingItem) {
                console.error('Item not found:', fetchError);
                Alert.alert('Error', 'Item not found.');
                return;
              }

              // Verify the item belongs to the current user
              if (existingItem.user_id !== session.user.id) {
                console.error('Item does not belong to current user. Item user_id:', existingItem.user_id, 'Current user_id:', session.user.id);
                Alert.alert('Error', 'You do not have permission to delete this item.');
                return;
              }

              console.log('Item found and verified, proceeding with delete...');
              
              // Delete from Supabase - only using id since we already verified ownership
              const { error, count } = await supabase
                .from('history')
                .delete({ count: 'exact' })
                .eq('id', historyItemId)
                .eq('user_id', session.user.id);

              console.log('Delete response:', { error, count, historyItemId });

              if (error) {
                console.error('Error deleting history item:', error);
                Alert.alert('Error', `Failed to delete item: ${error.message}`);
                return;
              }

              // Check if any rows were actually deleted
              if (count !== null && count === 0) {
                console.error('Delete returned 0 rows - RLS policy may be blocking deletion');
                Alert.alert('Error', 'Failed to delete item. This may be a permissions issue.');
                return;
              }

              console.log('Item deleted successfully. Rows deleted:', count);
              
              // Small delay to ensure database consistency
              await new Promise(resolve => setTimeout(resolve, 300));
              
              // Navigate back immediately - the useFocusEffect will refresh the list
              navigation.goBack();
            } catch (error) {
              console.error('Error deleting history item:', error);
              Alert.alert('Error', 'An error occurred while deleting the item.');
            }
          }
        }
      ]
    );
  };

  const hasBottomArea = !!fromOnboarding;

  return (
    <TrackPreviewProvider>
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['left', 'right']}>
      {/* Floating Action Buttons */}
      {!fromOnboarding && (
        <View style={[styles.floatingActions, { top: insets.top + 10 }]}>
          <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          {historyItemId && (
            <TouchableOpacity onPress={handleDeletePress} style={styles.deleteButton}>
              <MaterialCommunityIcons name="delete" size={24} color={Colors.accent.red} />
            </TouchableOpacity>
          )}
        </View>
      )}
      
      <View style={styles.container}>
        {/* Background Blur Effects */}
        <View style={styles.backgroundBlur1} />
        <View style={styles.backgroundBlur2} />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, hasBottomArea && styles.scrollContentWithBottomArea]}
          showsVerticalScrollIndicator={false}
        >
          {/* HERO: full-bleed photo, gradient scrim, main match overlaid */}
          <Animated.View
            style={[
              styles.hero,
              {
                opacity: heroEnter,
                transform: [{ translateY: heroEnter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              },
            ]}
          >
            {imageUrl && (
              <TouchableOpacity onPress={handleImagePress} activeOpacity={0.96} style={StyleSheet.absoluteFill}>
                <Image source={{ uri: imageUrl }} style={styles.heroImage} />
              </TouchableOpacity>
            )}
            <LinearGradient
              colors={['transparent', 'transparent', Colors.background + 'CC', Colors.background]}
              locations={[0, 0.4, 0.8, 1]}
              style={styles.heroScrim}
              pointerEvents="none"
            />
            {songs[0] && (
              <View style={styles.heroMain} pointerEvents="box-none">
                <Text style={styles.mainSongLabel}>MAIN MATCH</Text>
                <Text style={styles.heroTitle} numberOfLines={2}>
                  {songs[0]?.title || 'Unknown Title'}
                </Text>
                <Text style={styles.heroArtist} numberOfLines={1}>
                  by {songs[0]?.artist || 'Unknown Artist'}
                </Text>
                {!!songs[0]?.reason && (
                  <Text style={styles.heroReason} numberOfLines={2} ellipsizeMode="tail">
                    {songs[0].reason}
                  </Text>
                )}
                <View style={styles.heroControls}>
                  <TrackPreviewButton song={songs[0]} variant="pill" />
                </View>
              </View>
            )}
          </Animated.View>

          {/* MORE MATCHES */}
          <Animated.View
            style={[
              styles.altSection,
              {
                opacity: listEnter,
                transform: [{ translateY: listEnter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
              },
            ]}
          >
            <Text style={styles.alternativesLabel}>MORE MATCHES</Text>
            <View style={styles.alternativesList}>
              {songs.slice(1, 3).map((song, idx) => (
                <View key={idx} style={styles.alternativeItem}>
                  {song?.album_cover ? (
                    <Image source={{ uri: song.album_cover }} style={styles.alternativeAlbumArt} />
                  ) : (
                    <View style={[styles.alternativeAlbumArt, styles.alternativeAlbumArtFallback]}>
                      <MaterialCommunityIcons name="music-note" size={24} color={Colors.textSecondary} />
                    </View>
                  )}
                  <View style={styles.alternativeInfo}>
                    <Text style={styles.alternativeTitle} numberOfLines={1}>
                      {song?.title || 'Unknown Title'}
                    </Text>
                    <Text style={styles.alternativeArtist} numberOfLines={1}>
                      by {song?.artist || 'Unknown Artist'}
                    </Text>
                    <Text style={styles.alternativeReason} numberOfLines={2} ellipsizeMode="tail">
                      {song?.reason || ''}
                    </Text>
                  </View>
                  {song && <TrackPreviewButton song={song} variant="small" />}
                </View>
              ))}
            </View>
          </Animated.View>

          {/* Start Exploring lives inside the scroll content so it is never
              clipped by the bottom tab bar and is always reachable. */}
          {fromOnboarding && (
            <TouchableOpacity
              style={styles.exploreButtonWrapper}
              onPress={handleStartExploring}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#FF3B30', '#FF2D55']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.exploreButton}
              >
                <Text style={styles.exploreButtonText}>Start Exploring</Text>
                <MaterialCommunityIcons name="arrow-right" size={22} color="#FFFFFF" />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {/* Full-Screen Image Modal */}
      <Modal
        visible={imageModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeImageModal}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity
            style={styles.modalBackground}
            onPress={closeImageModal}
            activeOpacity={1}
          >
            <SafeAreaView style={styles.modalContent}>
              {/* Close Button */}
              <TouchableOpacity
                style={[styles.closeButton, { top: insets.top + 10 }]}
                onPress={closeImageModal}
              >
                <MaterialCommunityIcons name="close" size={28} color={Colors.textPrimary} />
              </TouchableOpacity>

              {/* Full-Screen Image */}
              <View style={styles.fullImageContainer}>
                {imageUrl && modalImageSize ? (
                  <Image
                    source={{ uri: imageUrl }}
                    style={[styles.fullImage, modalImageSize]}
                    resizeMode="contain"
                  />
                ) : (
                  <ActivityIndicator size="large" color="#FF3B30" />
                )}
              </View>

              {/* Image Info */}
              <View style={styles.imageInfo}>
                <Text style={styles.imageInfoText}>
                  Tap anywhere to close
                </Text>
              </View>
            </SafeAreaView>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
    </TrackPreviewProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#221019', // Matching DashboardScreen background
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: Spacing.xl,
  },
  scrollContentWithBottomArea: {
    // Clears the floating bottom tab bar so the inline Start Exploring button
    // is fully visible when scrolled to the end.
    paddingBottom: 120,
  },

  // Direction A: immersive hero
  hero: {
    width: '100%',
    height: height * 0.6,
    backgroundColor: Colors.cardBackground,
  },
  heroImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  heroExpand: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: Colors.background + 'AA',
    borderRadius: BorderRadius.round,
    padding: 6,
  },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  heroMain: {
    position: 'absolute',
    left: Layout.screenPadding,
    right: Layout.screenPadding,
    bottom: Spacing.lg,
  },
  heroTitle: {
    ...Typography.heading2,
    fontSize: 26,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.4,
    lineHeight: 30,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 1 },
  },
  heroArtist: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  heroReason: {
    ...Typography.caption,
    color: Colors.textTertiary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  heroControls: {
    marginTop: 16,
  },
  altSection: {
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.lg,
    paddingBottom: 110, // clear the floating bottom tab bar so the last card is fully visible
  },
  
  // Animation styles
  matchOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    zIndex: 1000,
    overflow: 'hidden',
  },
  matchTextContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '90%',
  },
  matchBackgroundGradient: {
    position: 'absolute',
    top: -100,
    left: -100,
    right: -100,
    bottom: -100,
  },
  expandingRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 3,
    borderColor: '#FF3B30',
    top: '50%',
    left: '50%',
    marginLeft: -100,
    marginTop: -100,
  },
  glowEffect: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#FF3B30',
    opacity: 0.3,
  },
  matchText: {
    ...Typography.display,
    fontSize: 42,
    fontWeight: '900',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    textShadowColor: '#FF3B30',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
    letterSpacing: 1,
    includeFontPadding: false,
    paddingHorizontal: Spacing.sm,
  },
  matchSubtext: {
    ...Typography.body,
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 16,
    marginTop: Spacing.md,
    fontWeight: '400',
    lineHeight: 22,
    paddingHorizontal: Spacing.lg,
  },
  confettiEmoji: {
    fontSize: 48,
    textAlign: 'center',
  },
  songRecommendationCard: {
    width: width * 0.85,
    marginTop: Spacing.xxl,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  songCardGradient: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
  },
  songCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: Spacing.sm,
    gap: Spacing.md,
  },
  albumArt: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.md,
    backgroundColor: '#E0E0E0',
    flexShrink: 0,
  },
  songInfoContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: Spacing.sm,
  },
  songTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F1F1F',
    marginBottom: 4,
  },
  songArtist: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(31, 31, 31, 0.7)',
  },
  curvedLine1: {
    position: 'absolute',
    top: height * 0.15,
    right: -width * 0.3,
    width: width * 0.6,
    height: width * 0.6,
    borderWidth: 2,
    borderColor: '#FF3B3040',
    borderRadius: width * 0.3,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
  },
  curvedLine2: {
    position: 'absolute',
    bottom: height * 0.15,
    left: -width * 0.3,
    width: width * 0.6,
    height: width * 0.6,
    borderWidth: 2,
    borderColor: '#FF3B3040',
    borderRadius: width * 0.3,
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  },
   
   // Tinder-style match cards
   matchCardsContainer: {
     position: 'absolute',
     top: 0,
     left: 0,
     right: 0,
     bottom: 0,
     justifyContent: 'center',
     alignItems: 'center',
     zIndex: 999,
   },
   matchCard: {
     position: 'absolute',
     width: 180,
     height: 240,
     borderRadius: BorderRadius.lg,
     backgroundColor: Colors.cardBackground,
     shadowColor: Colors.background,
     shadowOffset: { width: 0, height: 8 },
     shadowOpacity: 0.4,
     shadowRadius: 16,
     elevation: 12,
     overflow: 'hidden',
   },
   matchCardImage: {
     width: '100%',
     height: '85%',
     resizeMode: 'cover',
   },
   matchCardOverlay: {
     position: 'absolute',
     bottom: 0,
     left: 0,
     right: 0,
     backgroundColor: '#FF3B30E0',
     paddingVertical: Spacing.sm,
     alignItems: 'center',
   },
   matchCardLabel: {
     ...Typography.caption,
     color: Colors.textPrimary,
     fontWeight: '700',
     fontSize: 10,
     letterSpacing: 1,
   },
   
   // Continue button
   continueButtonContainer: {
     position: 'absolute',
     bottom: 100,
     left: 0,
     right: 0,
     alignItems: 'center',
     zIndex: 1000,
   },
   continueButton: {
     flexDirection: 'row',
     alignItems: 'center',
     backgroundColor: '#FF3B30',
     paddingHorizontal: Spacing.xl,
     paddingVertical: Spacing.lg,
     borderRadius: BorderRadius.round,
     shadowColor: '#FF3B30',
     shadowOffset: { width: 0, height: 4 },
     shadowOpacity: 0.3,
     shadowRadius: 12,
     elevation: 8,
   },
   continueButtonText: {
     ...Typography.button,
     color: Colors.textPrimary,
     fontWeight: '700',
     marginRight: Spacing.sm,
     fontSize: 16,
   },
  contentContainer: {
    flex: 1,
    padding: Layout.screenPadding,
  },
  floatingActions: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    zIndex: 100,
  },
  exploreButtonWrapper: {
    marginHorizontal: Layout.screenPadding,
    marginTop: Spacing.lg,
  },
  exploreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md + 2,
    borderRadius: BorderRadius.round,
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  exploreButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  backButton: {
    backgroundColor: Colors.cardBackground + 'E0',
    borderRadius: BorderRadius.round,
    padding: Spacing.md,
    shadowColor: Colors.background,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  deleteButton: {
    backgroundColor: Colors.cardBackground + 'E0',
    borderRadius: BorderRadius.round,
    padding: Spacing.md,
    shadowColor: Colors.background,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  
  // Top Section: Image + Main Song
  topSection: {
    flexDirection: 'row',
    marginBottom: Spacing.xl,
    minHeight: 160, // Minimum height, but allow expansion
    marginTop: 80, // Add top margin for floating buttons with safe area
    alignItems: 'flex-start', // Align items to top to allow text expansion
  },
  imageContainer: {
    width: 160,
    height: 160,
    borderRadius: BorderRadius.lg,
    padding: 6,
    backgroundColor: '#FF3B3030',
    borderWidth: 2,
    borderColor: '#FF3B3060',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
     image: { 
     width: '100%', 
     height: '100%', 
     borderRadius: BorderRadius.md,
   },
   imageTouchable: {
     width: '100%',
     height: '100%',
     position: 'relative',
   },
   imageOverlay: {
     position: 'absolute',
     top: 8,
     right: 8,
     backgroundColor: Colors.background + 'CC',
     borderRadius: BorderRadius.round,
     padding: 6,
     shadowColor: Colors.background,
     shadowOffset: { width: 0, height: 2 },
     shadowOpacity: 0.3,
     shadowRadius: 8,
     elevation: 2,
   },
   expandIcon: {
     // No additional styling needed
   },
  mainSongContainer: {
    flex: 1,
    marginLeft: Spacing.lg,
    justifyContent: 'flex-start',
    paddingRight: Spacing.sm,
  },
  mainSongLabel: {
    ...Typography.caption,
    color: '#FF3B30',
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 1 },
  },
  mainSongTitle: {
    ...Typography.heading2,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
    lineHeight: 24,
  },
  mainSongArtist: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  mainSongReason: {
    ...Typography.caption,
    color: Colors.textTertiary,
    fontStyle: 'italic',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  // Bottom Section: Alternatives
  bottomSection: {
    flex: 1,
  },
  alternativesLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  alternativesList: {
    gap: Spacing.md,
  },
  alternativeItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.cardBackground,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent.yellow,
    minHeight: 0, // Allow items to expand based on content
  },
  alternativeAlbumArt: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    marginRight: Spacing.md,
    backgroundColor: Colors.cardBackgroundSecondary,
    flexShrink: 0,
  },
  alternativeAlbumArtFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  alternativeInfo: {
    flex: 1,
    paddingRight: Spacing.sm,
    minWidth: 0, // Allow text to shrink and wrap properly
  },
  alternativeTitle: {
    ...Typography.body,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  alternativeArtist: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  alternativeReason: {
    ...Typography.caption,
    color: Colors.textTertiary,
    fontSize: 11,
    fontStyle: 'italic',
    lineHeight: 16,
    flexShrink: 1,
  },
  // Full-Screen Image Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    right: 20,
    zIndex: 1000,
    backgroundColor: Colors.cardBackground + 'E0',
    borderRadius: BorderRadius.round,
    padding: Spacing.md,
    shadowColor: Colors.background,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  fullImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    width: '100%',
  },
  fullImage: {
    borderRadius: BorderRadius.md,
  },
  imageInfo: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  imageInfoText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    backgroundColor: Colors.background + 'CC',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  backgroundBlur1: {
    position: 'absolute',
    top: -height * 0.1,
    left: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: '#f4258c20', // Pink/primary color matching DashboardScreen
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
    backgroundColor: '#8b5cf620', // Purple accent matching DashboardScreen
    borderRadius: 9999,
    opacity: 0.3,
    zIndex: 0,
  },
});

export default ResultsScreen; 