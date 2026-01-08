import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Linking, TouchableOpacity, Alert, Animated, Dimensions, Modal, ActivityIndicator, ScrollView } from 'react-native';
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

type Song = {
  title: string;
  artist: string;
  reason: string;
  spotify_url?: string;
  album_cover?: string; // Album cover image URL
};

type ResultsParams = {
  image: string; // This can be either a file path or signed URL
  songs: Song[];
  historyItemId?: string; // Optional history item ID for deletion
  imagePath?: string; // Original storage path for refreshing signed URLs
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
  const { image, songs = [], historyItemId, imagePath } = (route.params || {}) as ResultsParams;
  const [imageUrl, setImageUrl] = useState<string>(image);
  const [showAnimation, setShowAnimation] = useState(!historyItemId); // Only animate for new results, not history
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
  
  // Simplified emoji animations - individual refs to avoid tracking errors
  const emoji1Scale = useRef(new Animated.Value(0)).current;
  const emoji1Rotation = useRef(new Animated.Value(0)).current;
  const emoji2Scale = useRef(new Animated.Value(0)).current;
  const emoji2Rotation = useRef(new Animated.Value(0)).current;
  const emoji3Scale = useRef(new Animated.Value(0)).current;
  const emoji3Rotation = useRef(new Animated.Value(0)).current;
  const backgroundPulse = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(showAnimation ? 1 : 0)).current;
  const imageScale = useRef(new Animated.Value(showAnimation ? 1.5 : 1)).current;
  const imagePosition = useRef(new Animated.ValueXY(showAnimation ? { x: 0, y: 0 } : { x: 0, y: 0 })).current;
  const contentOpacity = useRef(new Animated.Value(showAnimation ? 0 : 1)).current;
  const mainSongOpacity = useRef(new Animated.Value(showAnimation ? 0 : 1)).current;
  const alternativesOpacity = useRef(new Animated.Value(showAnimation ? 0 : 1)).current;
  
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

        // Animate emojis with bounce - using individual refs to avoid tracking errors
        const animateEmoji = (scale: Animated.Value, rotation: Animated.Value, delay: number) => {
          setTimeout(() => {
            Animated.parallel([
              Animated.spring(scale, {
                toValue: 1,
                tension: 100,
                friction: 6,
                useNativeDriver: true,
              }),
              Animated.sequence([
                Animated.timing(rotation, {
                  toValue: 1,
                  duration: 300,
                  useNativeDriver: true,
                }),
                Animated.timing(rotation, {
                  toValue: 0,
                  duration: 300,
                  useNativeDriver: true,
                }),
              ]),
            ]).start();

            // Continuous bounce animation
            Animated.loop(
              Animated.sequence([
                Animated.timing(scale, {
                  toValue: 1.2,
                  duration: 800,
                  useNativeDriver: true,
                }),
                Animated.timing(scale, {
                  toValue: 1,
                  duration: 800,
                  useNativeDriver: true,
                }),
              ])
            ).start();
          }, delay);
        };

        animateEmoji(emoji1Scale, emoji1Rotation, 800);
        animateEmoji(emoji2Scale, emoji2Rotation, 950);
        animateEmoji(emoji3Scale, emoji3Rotation, 1100);
      }, 500);

      // Step 3: Hide match text, fade out overlay, and animate image to position (after 3 seconds)
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
      }, 3500);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Floating Action Buttons */}
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
      
      <View style={styles.container}>
        {/* "It's a Match!" Overlay with Enhanced Effects */}
        {showAnimation && (
          <Animated.View 
            style={[
              styles.matchOverlay,
              {
                opacity: overlayOpacity,
              }
            ]}
          >
            {/* Pulsing Background Gradient */}
            <Animated.View
              style={[
                styles.matchBackgroundGradient,
                {
                  opacity: backgroundPulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 0.5],
                  }),
                }
              ]}
            >
              <LinearGradient
                colors={[Colors.accent.blue + '20', Colors.accent.coral + '15', Colors.accent.yellow + '10', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>

            {/* Expanding Rings - Seamlessly Looping */}
            <Animated.View
              style={[
                styles.expandingRing,
                {
                  transform: [
                    { scale: ring1Scale },
                    { translateX: 0 },
                    { translateY: 0 },
                  ],
                  opacity: ring1Opacity,
                }
              ]}
            />
            <Animated.View
              style={[
                styles.expandingRing,
                {
                  transform: [
                    { scale: ring2Scale },
                    { translateX: 0 },
                    { translateY: 0 },
                  ],
                  opacity: ring2Opacity,
                }
              ]}
            />
            <Animated.View
              style={[
                styles.expandingRing,
                {
                  transform: [
                    { scale: ring3Scale },
                    { translateX: 0 },
                    { translateY: 0 },
                  ],
                  opacity: ring3Opacity,
                }
              ]}
            />

            {/* Particle effects removed - using rings and glow instead for better performance */}

            {/* Glow Effect */}
            <Animated.View
              style={[
                styles.glowEffect,
                {
                  opacity: glowOpacity,
                  transform: [{ scale: glowScale }],
                }
              ]}
            />

            {/* Main Match Text */}
            <Animated.View
              style={[
                styles.matchTextContainer,
                {
                  opacity: matchTextOpacity,
                  transform: [
                    { scale: matchTextScale },
                    {
                      rotate: matchTextRotation.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['-5deg', '5deg'],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text style={styles.matchText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                It's a Match! 🎉
              </Text>
              <Text style={styles.matchSubtext}>Perfect song found for your vibe</Text>
              <View style={styles.matchEmojiContainer}>
                <Animated.Text
                  style={[
                    styles.matchEmoji,
                    {
                      transform: [
                        { scale: emoji1Scale },
                        {
                          rotate: emoji1Rotation.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['-15deg', '15deg'],
                          }),
                        },
                      ],
                    }
                  ]}
                >
                  🎵
                </Animated.Text>
                <Animated.Text
                  style={[
                    styles.matchEmoji,
                    {
                      transform: [
                        { scale: emoji2Scale },
                        {
                          rotate: emoji2Rotation.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['-15deg', '15deg'],
                          }),
                        },
                      ],
                    }
                  ]}
                >
                  ✨
                </Animated.Text>
                <Animated.Text
                  style={[
                    styles.matchEmoji,
                    {
                      transform: [
                        { scale: emoji3Scale },
                        {
                          rotate: emoji3Rotation.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['-15deg', '15deg'],
                          }),
                        },
                      ],
                    }
                  ]}
                >
                  🔥
                </Animated.Text>
              </View>
            </Animated.View>
          </Animated.View>
        )}

         {/* Tinder-Style Match Cards */}
         {showMatchCards && (
           <View style={styles.matchCardsContainer}>
             {/* User Image Card */}
             <Animated.View
               style={[
                 styles.matchCard,
                 {
                   opacity: userCardOpacity,
                   transform: [
                     { translateX: userCardPosition.x },
                     { translateY: userCardPosition.y },
                     { 
                       rotate: userCardRotation.interpolate({
                         inputRange: [-180, 180],
                         outputRange: ['-180deg', '180deg'],
                       })
                     },
                   ],
                 }
               ]}
             >
               <Image source={{ uri: imageUrl }} style={styles.matchCardImage} />
               <View style={styles.matchCardOverlay}>
                 <Text style={styles.matchCardLabel}>YOUR VIBE</Text>
               </View>
             </Animated.View>

             {/* Album Cover Card */}
             <Animated.View
               style={[
                 styles.matchCard,
                 {
                   opacity: albumCardOpacity,
                   transform: [
                     { translateX: albumCardPosition.x },
                     { translateY: albumCardPosition.y },
                     { 
                       rotate: albumCardRotation.interpolate({
                         inputRange: [-180, 180],
                         outputRange: ['-180deg', '180deg'],
                       })
                     },
                   ],
                 }
               ]}
             >
               {/* Use album cover if available, otherwise show a placeholder */}
               <Image 
                 source={
                   songs[0]?.album_cover 
                     ? { uri: songs[0].album_cover }
                     : require('../../../assets/icon.png') // Fallback to app icon
                 } 
                 style={styles.matchCardImage} 
               />
               <View style={styles.matchCardOverlay}>
                 <Text style={styles.matchCardLabel}>PERFECT MATCH</Text>
               </View>
             </Animated.View>
           </View>
         )}

         {/* Continue Button */}
         {showContinueButton && (
           <Animated.View
             style={[
               styles.continueButtonContainer,
               { opacity: continueButtonOpacity }
             ]}
           >
             <TouchableOpacity
               style={styles.continueButton}
               onPress={handleContinueToResults}
             >
               <Text style={styles.continueButtonText}>See Results</Text>
               <MaterialCommunityIcons name="arrow-right" size={20} color={Colors.textPrimary} />
             </TouchableOpacity>
          </Animated.View>
        )}

        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Animated Content */}
          <Animated.View 
            style={[
              styles.contentContainer,
              { opacity: contentOpacity }
            ]}
          >
          {/* Top Section: Image + Main Song */}
          <View style={styles.topSection}>
            {/* Animated Image with Cool Border */}
            <Animated.View
              style={[
                styles.imageContainer,
                {
                  transform: [
                    { scale: imageScale },
                    { translateX: imagePosition.x },
                    { translateY: imagePosition.y },
                  ],
                }
              ]}
            >
              {imageUrl && (
                <TouchableOpacity
                  onPress={handleImagePress}
                  activeOpacity={0.9}
                  style={styles.imageTouchable}
                >
                  <Image source={{ uri: imageUrl }} style={styles.image} />
                  <View style={styles.imageOverlay}>
                    <MaterialCommunityIcons
                      name="magnify-plus"
                      size={20}
                      color={Colors.textPrimary}
                      style={styles.expandIcon}
                    />
                  </View>
                </TouchableOpacity>
              )}
            </Animated.View>
            
            {/* Main Song Recommendation */}
            <Animated.View 
              style={[
                styles.mainSongContainer,
                { opacity: mainSongOpacity }
              ]}
            >
              {songs[0] && (
                <>
                  <Text style={styles.mainSongLabel}>MAIN MATCH</Text>
                  <Text style={styles.mainSongTitle} numberOfLines={3}>
                    {songs[0].title}
                  </Text>
                  <Text style={styles.mainSongArtist} numberOfLines={2}>
                    by {songs[0].artist}
                  </Text>
                  <Text style={styles.mainSongReason} numberOfLines={6}>
                    {songs[0].reason}
                  </Text>
                  {songs[0].spotify_url && (
                    <TouchableOpacity 
                      style={styles.spotifyButton}
                      onPress={() => Linking.openURL(songs[0].spotify_url)}
                    >
                      <MaterialCommunityIcons name="spotify" size={16} color={Colors.textPrimary} />
                      <Text style={styles.spotifyText}>Play</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </Animated.View>
          </View>

          {/* Bottom Section: Alternative Songs */}
          <Animated.View 
            style={[
              styles.bottomSection,
              { opacity: alternativesOpacity }
            ]}
          >
            <Text style={styles.alternativesLabel}>ALTERNATIVES</Text>
            <View style={styles.alternativesList}>
              {songs.slice(1, 3).map((song, idx) => {
                const anim = alternativeAnimations[idx] || { opacity: new Animated.Value(1), translateX: new Animated.Value(0) };
                return (
                <Animated.View 
                  key={idx} 
                  style={[
                    styles.alternativeItem,
                    {
                      opacity: anim.opacity,
                      transform: [{ translateX: anim.translateX }],
                    }
                  ]}
                >
                  <View style={styles.alternativeInfo}>
                    <Text style={styles.alternativeTitle} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={styles.alternativeArtist} numberOfLines={2}>
                      by {song.artist}
                    </Text>
                    <Text style={styles.alternativeReason} numberOfLines={5}>
                      {song.reason}
                    </Text>
                  </View>
                  {song.spotify_url && (
                    <TouchableOpacity 
                      style={styles.smallSpotifyButton}
                      onPress={() => Linking.openURL(song.spotify_url)}
                    >
                      <MaterialCommunityIcons name="spotify" size={14} color={Colors.accent.green} />
                    </TouchableOpacity>
                  )}
                </Animated.View>
              );
              })}
            </View>
          </Animated.View>
        </Animated.View>
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
                  <ActivityIndicator size="large" color={Colors.accent.blue} />
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
    flexGrow: 1,
    paddingBottom: Spacing.xl,
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
    borderColor: Colors.accent.blue,
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
    backgroundColor: Colors.accent.blue,
    opacity: 0.3,
  },
  matchText: {
    ...Typography.display,
    fontSize: 42,
    fontWeight: '900',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    textShadowColor: Colors.accent.blue,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
    letterSpacing: 1,
    includeFontPadding: false,
    paddingHorizontal: Spacing.sm,
  },
  matchSubtext: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    fontSize: 18,
    marginTop: Spacing.xs,
    fontWeight: '500',
  },
  matchEmojiContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.md,
    gap: Spacing.md,
  },
  matchEmoji: {
    fontSize: 32,
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
     backgroundColor: Colors.accent.blue + 'E0',
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
     backgroundColor: Colors.accent.blue,
     paddingHorizontal: Spacing.xl,
     paddingVertical: Spacing.lg,
     borderRadius: BorderRadius.round,
     shadowColor: Colors.accent.blue,
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
    backgroundColor: Colors.accent.blue + '30',
    borderWidth: 2,
    borderColor: Colors.accent.blue + '60',
    shadowColor: Colors.accent.blue,
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
    color: Colors.accent.blue,
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
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
    flexShrink: 1,
  },
  spotifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.accent.green,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    alignSelf: 'flex-start',
  },
  spotifyText: {
    ...Typography.button,
    color: Colors.textPrimary,
    marginLeft: Spacing.xs,
    fontSize: 14,
    fontWeight: '600',
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
  smallSpotifyButton: {
    backgroundColor: Colors.accent.green + '30',
    padding: Spacing.sm,
    borderRadius: BorderRadius.round,
    marginTop: Spacing.xs, // Align with top of text content
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
});

export default ResultsScreen; 