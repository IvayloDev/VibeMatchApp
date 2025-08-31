import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Image, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Button, RadioButton } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deductCredits, getUserCredits } from '../../../lib/credits';
import { Colors, Typography, Spacing, BorderRadius } from '../../../lib/designSystem';

type RootStackParamList = {
  Analyzing: { image: string; type: 'surprise' | 'genre'; selectedGenre?: string };
  Payment: undefined;
  // ...other routes
};

type RouteParams = {
  image: string;
};

const genres = [
  { id: 'pop', name: 'Pop', emoji: '🎵' },
  { id: 'rap', name: 'Rap', emoji: '🎤' },
  { id: 'rock', name: 'Rock', emoji: '🤘' },
  { id: 'electronic', name: 'Electronic', emoji: '⚡' },
  { id: 'r&b', name: 'R&B', emoji: '💜' },
  { id: 'country', name: 'Country', emoji: '🤠' },
  { id: 'jazz', name: 'Jazz', emoji: '🎷' },
  { id: 'classical', name: 'Classical', emoji: '🎻' },
  { id: 'house', name: 'House', emoji: '🏠' },
  { id: 'reggae', name: 'Reggae', emoji: '🌴' },
  { id: 'blues', name: 'Blues', emoji: '💙' },
  { id: 'folk', name: 'Folk', emoji: '🌿' },
  { id: 'romantic', name: 'Romantic', emoji: '💕' },
  { id: 'sensual', name: 'Sensual', emoji: '💋' },
  { id: 'emotional', name: 'Emotional', emoji: '😢' },
  { id: 'funny', name: 'Funny', emoji: '😂' },
  { id: 'chill', name: 'Chill', emoji: '😌' },
  { id: 'energetic', name: 'Energetic', emoji: '🔥' },
  { id: 'sad', name: 'Sad', emoji: '💔' },
  { id: 'happy', name: 'Happy', emoji: '😊' },
  { id: 'nostalgic', name: 'Nostalgic', emoji: '🕰️' },
  { id: 'motivational', name: 'Motivational', emoji: '💪' },
  { id: 'relaxing', name: 'Relaxing', emoji: '🧘' },
  { id: 'party', name: 'Party', emoji: '🎉' },
  { id: 'workout', name: 'Workout', emoji: '🏃' },
  { id: 'study', name: 'Study', emoji: '📚' },
  { id: 'sleep', name: 'Sleep', emoji: '😴' },
  { id: 'indie', name: 'Indie', emoji: '🎸' },
  { id: 'alternative', name: 'Alternative', emoji: '🎭' },
  { id: 'punk', name: 'Punk', emoji: '🖤' },
  { id: 'metal', name: 'Metal', emoji: '🤘' },
  { id: 'soul', name: 'Soul', emoji: '🎤' },
  { id: 'funk', name: 'Funk', emoji: '🎺' },
  { id: 'disco', name: 'Disco', emoji: '🕺' },
  { id: 'latin', name: 'Latin', emoji: '💃' },
  { id: 'kpop', name: 'K-Pop', emoji: '🌟' },
  { id: 'jpop', name: 'J-Pop', emoji: '🌸' },
  { id: 'hiphop', name: 'Hip Hop', emoji: '🎧' },
  { id: 'trap', name: 'Trap', emoji: '🎛️' },
  { id: 'dubstep', name: 'Dubstep', emoji: '🎚️' },
  { id: 'ambient', name: 'Ambient', emoji: '🌫️' },
  { id: 'lo-fi', name: 'Lo-Fi', emoji: '☕' },
  { id: 'synthwave', name: 'Synthwave', emoji: '🌆' },
  { id: 'vaporwave', name: 'Vaporwave', emoji: '🌊' },
  { id: 'retro', name: 'Retro', emoji: '📼' },
  { id: 'futuristic', name: 'Futuristic', emoji: '🚀' },
  { id: 'mystical', name: 'Mystical', emoji: '🔮' },
  { id: 'epic', name: 'Epic', emoji: '⚔️' },
  { id: 'cinematic', name: 'Cinematic', emoji: '🎬' },
  { id: 'acoustic', name: 'Acoustic', emoji: '🎹' },
  { id: 'orchestral', name: 'Orchestral', emoji: '🎼' },
  { id: 'gospel', name: 'Gospel', emoji: '🙏' },
  { id: 'spiritual', name: 'Spiritual', emoji: '✨' },
  { id: 'meditation', name: 'Meditation', emoji: '🧘‍♀️' },
  { id: 'nature', name: 'Nature', emoji: '🌲' },
  { id: 'ocean', name: 'Ocean', emoji: '🌊' },
  { id: 'mountain', name: 'Mountain', emoji: '⛰️' },
  { id: 'city', name: 'City', emoji: '🏙️' },
  { id: 'roadtrip', name: 'Road Trip', emoji: '🚗' },
  { id: 'summer', name: 'Summer', emoji: '☀️' },
  { id: 'winter', name: 'Winter', emoji: '❄️' },
  { id: 'autumn', name: 'Autumn', emoji: '🍂' },
  { id: 'spring', name: 'Spring', emoji: '🌸' },
];

const RecommendationTypeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { image } = (route.params || {}) as RouteParams;
  const [type, setType] = useState<'surprise' | 'genre'>('surprise');
  const [selectedGenre, setSelectedGenre] = useState(genres[0].id);
  const [loading, setLoading] = useState(false);

  const handleStartAnalysis = async () => {
    try {
      setLoading(true);

      // Check if user has enough credits first
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

      // Deduct 1 credit for the analysis
      const deductionSuccess = await deductCredits(1);
      if (!deductionSuccess) {
        Alert.alert(
          'Error',
          'Failed to deduct credits. Please try again.',
          [{ text: 'OK' }]
        );
        return;
      }

      console.log('Credits deducted successfully. Remaining credits:', currentCredits - 1);

      // Navigate to analyzing screen with the selected options
      navigation.navigate('Analyzing', { 
        image, 
        type, 
        selectedGenre: type === 'genre' ? selectedGenre : undefined 
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

  const renderGenreGrid = () => {
    const rows = [];
    for (let i = 0; i < genres.length; i += 3) {
      const row = (
        <View key={i} style={styles.genreRow}>
          {genres.slice(i, i + 3).map((genre) => (
            <TouchableOpacity
              key={genre.id}
              style={[
                styles.genreCard,
                type === 'genre' && selectedGenre === genre.id && styles.selectedGenreCard
              ]}
              onPress={() => {
                setType('genre');
                setSelectedGenre(genre.id);
              }}
            >
              <Text style={styles.genreEmoji}>
                {genre.emoji}
              </Text>
              <Text style={[
                styles.genreName,
                type === 'genre' && selectedGenre === genre.id && styles.selectedGenreName
              ]}>
                {genre.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      );
      rows.push(row);
    }
    return rows;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {image && <Image source={{ uri: image }} style={styles.imagePreview} />}
        
        <Text variant="titleLarge" style={styles.title}>
          How should we match the vibe?
        </Text>

        {/* Surprise Me Option */}
        <TouchableOpacity
          style={[
            styles.surpriseCard,
            type === 'surprise' && styles.selectedSurpriseCard
          ]}
          onPress={() => setType('surprise')}
        >
          <Text style={styles.surpriseEmoji}>
            🎲
          </Text>
          <Text style={[
            styles.surpriseText,
            type === 'surprise' && styles.selectedSurpriseText
          ]}>
            Surprise Me
          </Text>
          <Text style={styles.surpriseSubtext}>
            Let AI choose the perfect genre for your vibe
          </Text>
        </TouchableOpacity>

        <Text variant="titleMedium" style={styles.genreSectionTitle}>
          Or choose a specific genre:
        </Text>

        {/* Genre Grid */}
        <View style={styles.genreGrid}>
          {renderGenreGrid()}
        </View>
      </ScrollView>
      
      {/* Analyze Button - Fixed at bottom */}
      <View style={styles.buttonContainer}>
        <Button 
          mode="contained" 
          style={styles.startButton} 
          onPress={handleStartAnalysis}
          loading={loading}
          disabled={loading}
        >
          {loading ? 'Processing...' : 'Analyze'}
        </Button>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background 
  },
  scrollContainer: { 
    padding: Spacing.lg, 
    alignItems: 'center' 
  },
  imagePreview: { 
    width: 200, 
    height: 200, 
    marginBottom: Spacing.xl, 
    borderRadius: BorderRadius.md 
  },
  title: { 
    ...Typography.heading2,
    marginBottom: Spacing.xl, 
    textAlign: 'center',
    color: Colors.textPrimary
  },
  surpriseCard: {
    width: '80%',
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBackground,
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  selectedSurpriseCard: {
    borderColor: Colors.accent.blue,
    backgroundColor: Colors.accent.blue + '08',
  },
  surpriseEmoji: {
    fontSize: 36,
    marginBottom: 6,
  },
  surpriseText: {
    ...Typography.heading3,
    marginBottom: Spacing.xs,
    color: Colors.textPrimary,
  },
  selectedSurpriseText: {
    color: Colors.accent.blue,
  },
  surpriseSubtext: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  genreSectionTitle: {
    ...Typography.heading3,
    marginBottom: Spacing.md,
    textAlign: 'center',
    color: Colors.textPrimary,
  },
  genreGrid: {
    width: '100%',
    marginBottom: Spacing.xl,
  },
  genreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  genreCard: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBackground,
    alignItems: 'center',
    marginHorizontal: Spacing.xs,
    minHeight: 85,
    shadowColor: Colors.background,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  selectedGenreCard: {
    borderColor: Colors.accent.blue,
    backgroundColor: Colors.accent.blue + '05',
    borderWidth: 2,
  },
  genreEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  genreName: {
    ...Typography.caption,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 14,
  },
  selectedGenreName: {
    color: Colors.accent.blue,
    fontWeight: '700',
  },
  buttonContainer: {
    padding: Spacing.lg,
    paddingBottom: 0,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    alignItems: 'center',
  },
  startButton: {
    width: '100%',
  },
});

export default RecommendationTypeScreen; 