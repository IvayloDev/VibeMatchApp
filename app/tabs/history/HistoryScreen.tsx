import React from 'react';
import { View, StyleSheet, FlatList, Image, TouchableOpacity } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

// Mock history data
const mockHistory = [
  {
    id: '1',
    image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
    songs: [
      { title: 'Blinding Lights', artist: 'The Weeknd' },
      { title: 'Levitating', artist: 'Dua Lipa' },
    ],
  },
  {
    id: '2',
    image: 'https://images.unsplash.com/photo-1465101046530-73398c7f28ca',
    songs: [
      { title: 'Peaches', artist: 'Justin Bieber' },
      { title: 'Save Your Tears', artist: 'The Weeknd' },
    ],
  },
];

const HistoryScreen = () => {
  const navigation = useNavigation();

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={mockHistory}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Results', { image: item.image, songs: item.songs })}
        >
          <Card style={styles.card}>
            <View style={styles.row}>
              <Image source={{ uri: item.image }} style={styles.thumbnail} />
              <View style={{ flex: 1, marginLeft: 16 }}>
                <Text variant="titleMedium">Songs:</Text>
                {item.songs.slice(0, 2).map((song, idx) => (
                  <Text key={idx}>{song.title} — {song.artist}</Text>
                ))}
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      )}
    />
  );
};

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#fff' },
  card: { marginBottom: 16, padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  thumbnail: { width: 80, height: 80, borderRadius: 8 },
});

export default HistoryScreen; 