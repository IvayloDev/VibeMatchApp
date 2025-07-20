import React, { useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { Text, Button, RadioButton } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';

const genres = ['Pop', 'Rap', 'House', 'Rock', 'Jazz', 'Classical'];

const RecommendationTypeScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { image } = route.params || {};
  const [type, setType] = useState<'surprise' | 'genre'>('surprise');
  const [selectedGenre, setSelectedGenre] = useState(genres[0]);

  return (
    <View style={styles.container}>
      {image && <Image source={{ uri: image }} style={styles.imagePreview} />}
      <Text variant="titleLarge" style={{ marginBottom: 16 }}>
        How should we match the vibe?
      </Text>
      <RadioButton.Group onValueChange={value => setType(value as 'surprise' | 'genre')} value={type}>
        <RadioButton.Item label="🎲 Surprise Me" value="surprise" />
        <RadioButton.Item label="🎧 Choose Genre" value="genre" />
      </RadioButton.Group>
      {type === 'genre' && (
        <RadioButton.Group onValueChange={setSelectedGenre} value={selectedGenre}>
          {genres.map(genre => (
            <RadioButton.Item key={genre} label={genre} value={genre} />
          ))}
        </RadioButton.Group>
      )}
      <Button mode="contained" style={{ marginTop: 24 }} onPress={() => {
        navigation.navigate('Analyzing', { image, type, selectedGenre });
      }}>
        Next
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  imagePreview: { width: 200, height: 200, marginBottom: 16, borderRadius: 12 },
});

export default RecommendationTypeScreen; 