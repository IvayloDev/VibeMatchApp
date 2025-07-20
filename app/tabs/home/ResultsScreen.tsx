import React from 'react';
import { View, StyleSheet, Image, ScrollView, Linking } from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { useRoute, useNavigation } from '@react-navigation/native';

const ResultsScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  // These would be passed from AnalyzingScreen after OpenAI/Spotify integration
  const { image, songs = [] } = route.params || {};

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {image && <Image source={{ uri: image }} style={styles.image} />}
      <Text variant="titleLarge" style={{ marginVertical: 16 }}>Top 3 Song Recommendations</Text>
      {songs.map((song, idx) => (
        <Card key={idx} style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">{song.title} — {song.artist}</Text>
            <Text style={{ marginVertical: 8 }}>{song.reason}</Text>
            {song.spotify_url && (
              <Button
                mode="outlined"
                onPress={() => Linking.openURL(song.spotify_url)}
                style={{ marginTop: 8 }}
              >
                Play Preview
              </Button>
            )}
          </Card.Content>
        </Card>
      ))}
      <Button mode="contained" style={{ marginTop: 24 }} onPress={() => {/* TODO: Get 3 more */}}>
        🔁 Get 3 More (1 credit)
      </Button>
      <Button mode="text" style={{ marginTop: 8 }} onPress={() => navigation.navigate('Dashboard')}>
        ⬅️ Back to Dashboard
      </Button>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  image: { width: 300, height: 300, borderRadius: 16, marginBottom: 16 },
  card: { width: '100%', marginVertical: 8 },
});

export default ResultsScreen; 