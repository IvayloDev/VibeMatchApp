import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, Image, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';

const HistoryScreen = () => {
  const navigation = useNavigation();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('history')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching history:', error);
      setHistory([]);
    } else {
      console.log('Fetched history:', data);
      setHistory(data || []);
    }
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <FlatList
        contentContainerStyle={styles.container}
        data={history}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate('Results', { image: item.image_url, songs: item.songs })}
          >
            <Card style={styles.card}>
              <View style={styles.row}>
                <Image source={{ uri: item.image_url }} style={styles.thumbnail} />
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <Text variant="titleMedium">Songs:</Text>
                  {(item.songs || []).slice(0, 2).map((song, idx) => (
                    <Text key={idx}>{song.title} — {song.artist}</Text>
                  ))}
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#fff' },
  card: { marginBottom: 16, padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  thumbnail: { width: 80, height: 80, borderRadius: 8 },
});

export default HistoryScreen; 