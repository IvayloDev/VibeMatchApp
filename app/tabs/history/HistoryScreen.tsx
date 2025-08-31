import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, Image, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase, getImageSignedUrl } from '../../../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Layout, BorderRadius } from '../../../lib/designSystem';

type TabParamList = {
  Home: undefined;
  History: undefined;
  Profile: undefined;
};

type HomeStackParamList = {
  Dashboard: undefined;
  RecommendationType: { image: string };
  Analyzing: undefined;
  Results: { image: string; songs: any[] };
};

type HistoryStackParamList = {
  History: undefined;
  Results: { image: string; songs: any[]; historyItemId?: string };
};

type HistoryNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'History'>,
  NativeStackNavigationProp<HistoryStackParamList>
>;

type HistoryItem = {
  id: string;
  image_url: string; // This is now the file path
  songs: any[];
  created_at: string;
};

const HistoryScreen = () => {
  const navigation = useNavigation<HistoryNavigationProp>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [imageUrls, setImageUrls] = useState<{ [key: string]: string }>({});

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
      
      // Generate fresh signed URLs for all images
      const urlPromises = (data || []).map(async (item) => {
        const signedUrl = await getImageSignedUrl(item.image_url);
        return { id: item.id, url: signedUrl };
      });
      
      const urlResults = await Promise.all(urlPromises);
      const urlMap: { [key: string]: string } = {};
      urlResults.forEach(({ id, url }) => {
        if (url) urlMap[id] = url;
      });
      setImageUrls(urlMap);
    }
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  // Load history on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  // Removed useFocusEffect to prevent automatic refresh on back swipe
  // Users can still manually refresh using pull-to-refresh

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.accent.blue} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        contentContainerStyle={styles.listContainer}
        data={history}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            tintColor={Colors.accent.blue}
          />
        }
        renderItem={({ item }) => {
          const currentImageUrl = imageUrls[item.id];
          return (
            <TouchableOpacity
              onPress={() => {
                // Navigate directly to Results screen in the same stack
                navigation.navigate('Results', { 
                  image: currentImageUrl || item.image_url, // Use signed URL if available, fallback to file path
                  songs: item.songs,
                  historyItemId: item.id // Pass the history item ID for deletion
                });
              }}
            >
              <Card style={styles.card}>
                <View style={styles.row}>
                  <Image 
                    source={{ uri: currentImageUrl || item.image_url }} 
                    style={styles.thumbnail}
                  />
                  <View style={styles.songsList}>
                    <Text variant="titleMedium" style={styles.songsLabel}>
                      {(item.songs || []).length} Song{(item.songs || []).length !== 1 ? 's' : ''}
                    </Text>
                    {(item.songs || []).slice(0, 2).map((song, idx) => (
                      <View key={idx} style={styles.songItem}>
                        <Text style={styles.songTitle} numberOfLines={1}>
                          {song.title}
                        </Text>
                        <Text style={styles.songArtist} numberOfLines={1}>
                          by {song.artist}
                        </Text>
                      </View>
                    ))}
                    {(item.songs || []).length > 2 && (
                      <Text style={styles.moreText}>
                        +{(item.songs || []).length - 2} more...
                      </Text>
                    )}
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: { 
    padding: Layout.screenPadding,
  },
  card: { 
    marginBottom: Spacing.md,
    backgroundColor: Colors.cardBackground,
    borderRadius: BorderRadius.md,
  },
  row: { 
    flexDirection: 'row', 
    alignItems: 'center',
    padding: Spacing.md,
  },
  thumbnail: { 
    width: 80, 
    height: 80, 
    borderRadius: BorderRadius.sm,
  },
  songsList: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  songsLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    fontSize: 12,
    fontWeight: '600',
  },
  songItem: {
    marginBottom: Spacing.sm,
  },
  songTitle: {
    ...Typography.body,
    fontWeight: '600',
    fontSize: 16,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  songArtist: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 13,
  },
  moreText: {
    ...Typography.caption,
    color: Colors.accent.blue,
    fontStyle: 'italic',
    marginTop: Spacing.xs,
  },
});

export default HistoryScreen; 