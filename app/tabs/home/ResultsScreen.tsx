import React from 'react';
import { View, StyleSheet, Image, ScrollView, Linking } from 'react-native';
import { Text, Button, Card, IconButton } from 'react-native-paper';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

type Song = {
  title: string;
  artist: string;
  reason: string;
  spotify_url?: string;
};

type ResultsParams = {
  image: string;
  songs: Song[];
};

type RootStackParamList = {
  Dashboard: undefined;
  // ...other routes
};

const ResultsScreen = () => {
  const route = useRoute();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { image, songs = [] } = (route.params || {}) as ResultsParams;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          size={24}
          onPress={() => navigation.navigate('History')}
        />
        <Text variant="titleMedium" style={styles.headerTitle}>Results</Text>
        <IconButton
          icon="shopping"
          size={24}
          onPress={() => navigation.navigate('Payment')}
        />
      </View>
      
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
                  Play on Spotify
                </Button>
              )}
            </Card.Content>
          </Card>
        ))}
        <Button mode="contained" style={{ marginTop: 24 }} onPress={() => {/* TODO: Get 3 more */}}>
          🔁 Get 3 More (1 credit)
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  container: { alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  image: { width: 300, height: 300, borderRadius: 16, marginBottom: 16 },
  card: { width: '100%', marginVertical: 8 },
});

export default ResultsScreen; 