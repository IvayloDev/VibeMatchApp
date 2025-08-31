import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Linking, TouchableOpacity, Alert, Animated, Dimensions, Modal } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useRoute, useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getImageSignedUrl } from '../../../lib/supabase';
import { supabase } from '../../../lib/supabase';
import { Colors, Typography, Spacing, Layout, BorderRadius } from '../../../lib/designSystem';

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
};

const ResultsScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { image, songs = [], historyItemId } = (route.params || {}) as ResultsParams;
  const [imageUrl, setImageUrl] = useState<string>(image);
  const [showAnimation, setShowAnimation] = useState(!historyItemId); // Only animate for new results, not history
  const [showMatchCards, setShowMatchCards] = useState(false);
  const [showContinueButton, setShowContinueButton] = useState(false);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  
  // Animation values
  const matchTextOpacity = useRef(new Animated.Value(0)).current;
  const matchTextScale = useRef(new Animated.Value(0.3)).current;
  const imageScale = useRef(new Animated.Value(showAnimation ? 1.5 : 1)).current;
  const imagePosition = useRef(new Animated.ValueXY(showAnimation ? { x: 0, y: 0 } : { x: 0, y: 0 })).current;
  const contentOpacity = useRef(new Animated.Value(showAnimation ? 0 : 1)).current;
  const mainSongOpacity = useRef(new Animated.Value(showAnimation ? 0 : 1)).current;
  const alternativesOpacity = useRef(new Animated.Value(showAnimation ? 0 : 1)).current;
  
  // Tinder-style match card animations
  const userCardPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const albumCardPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const userCardRotation = useRef(new Animated.Value(0)).current;
  const albumCardRotation = useRef(new Animated.Value(0)).current;
  const userCardOpacity = useRef(new Animated.Value(0)).current;
  const albumCardOpacity = useRef(new Animated.Value(0)).current;
  const continueButtonOpacity = useRef(new Animated.Value(0)).current;

  console.log('ResultsScreen params:', { image, songsCount: songs?.length, historyItemId, showAnimation });

  useEffect(() => {
    // Check if the image is a file path (doesn't start with http)
    if (image && !image.startsWith('http')) {
      // It's a file path, generate a fresh signed URL
      getImageSignedUrl(image).then(signedUrl => {
        if (signedUrl) {
          setImageUrl(signedUrl);
        }
      });
    }
  }, [image]);

  // Animation sequence
  useEffect(() => {
    if (showAnimation && songs.length > 0) {
      // Step 1: Show "It's a Match!" text (delay to let screen settle)
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
        ]).start();
      }, 300);

      // Step 2: Hide match text and animate image to position (after 2 seconds)
      setTimeout(() => {
        Animated.parallel([
          // Hide match text
          Animated.timing(matchTextOpacity, {
            toValue: 0,
            duration: 500,
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
        ]).start();
      }, 2500);

      // Step 3: Show content with staggered animations (after image settles)
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

        // Staggered reveal of alternatives
        setTimeout(() => {
          Animated.timing(alternativesOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }).start();
        }, 500);
      }, 3500);
    }
  }, [showAnimation, songs.length]);

  const handleBackPress = () => {
    navigation.goBack();
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

  const handleImagePress = () => {
    setImageModalVisible(true);
  };

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
                .select('*')
                .eq('id', historyItemId)
                .eq('user_id', session.user.id)
                .single();

              console.log('Existing item check:', { existingItem, fetchError });

              if (fetchError || !existingItem) {
                console.error('Item not found or does not belong to user');
                Alert.alert('Error', 'Item not found or you do not have permission to delete it.');
                return;
              }

              console.log('Item found, proceeding with delete');
              
              // Delete from Supabase
              const { error, data } = await supabase
                .from('history')
                .delete()
                .eq('id', historyItemId)
                .eq('user_id', session.user.id) // Also check user_id for security
                .select();

              console.log('Delete response:', { error, data });

              if (error) {
                console.error('Error deleting history item:', error);
                Alert.alert('Error', `Failed to delete item: ${error.message}`);
                return;
              }

              if (!data || data.length === 0) {
                console.log('No rows deleted - item may not exist or belong to user');
                Alert.alert('Error', 'Item not found or you do not have permission to delete it.');
                return;
              }

              console.log('Item deleted successfully');
              Alert.alert('Success', 'Item deleted successfully.');
              // Navigate back to history
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
                 {/* "It's a Match!" Overlay */}
         {showAnimation && (
           <Animated.View 
             style={[
               styles.matchOverlay,
               {
                 opacity: matchTextOpacity,
                 transform: [{ scale: matchTextScale }],
               }
             ]}
           >
             <Text style={styles.matchText}>It's a Match! 🎉</Text>
             <Text style={styles.matchSubtext}>Perfect song found for your vibe</Text>
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
                  <Text style={styles.mainSongArtist} numberOfLines={1}>
                    by {songs[0].artist}
                  </Text>
                  <Text style={styles.mainSongReason} numberOfLines={3}>
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
              {songs.slice(1, 3).map((song, idx) => (
                <View key={idx} style={styles.alternativeItem}>
                  <View style={styles.alternativeInfo}>
                    <Text style={styles.alternativeTitle} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={styles.alternativeArtist} numberOfLines={1}>
                      by {song.artist}
                    </Text>
                    <Text style={styles.alternativeReason} numberOfLines={2}>
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
                </View>
              ))}
            </View>
          </Animated.View>
        </Animated.View>
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
                {imageUrl && (
                  <Image
                    source={{ uri: imageUrl }}
                    style={styles.fullImage}
                    resizeMode="contain"
                  />
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
  
  // Animation styles
  matchOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background + 'F0',
    zIndex: 1000,
  },
  matchText: {
    ...Typography.display,
    fontSize: 36,
    fontWeight: '800',
    color: Colors.accent.blue,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    textShadowColor: Colors.accent.blue + '60',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
     matchSubtext: {
     ...Typography.body,
     color: Colors.textSecondary,
     textAlign: 'center',
     fontSize: 16,
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
    justifyContent: 'center',
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
    alignItems: 'center',
    backgroundColor: Colors.cardBackground,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent.yellow,
  },
  alternativeInfo: {
    flex: 1,
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
    lineHeight: 14,
  },
  smallSpotifyButton: {
    backgroundColor: Colors.accent.green + '30',
    padding: Spacing.sm,
    borderRadius: BorderRadius.round,
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
  },
  fullImage: {
    maxWidth: '100%',
    maxHeight: '100%',
    width: '100%',
    height: '100%',
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