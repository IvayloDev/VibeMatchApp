import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, FlatList, Image, TouchableOpacity, ActivityIndicator, RefreshControl, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { supabase, getImageSignedUrl } from '../../../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Layout, BorderRadius, Shadows } from '../../../lib/designSystem';
import { FloatingCard } from '../../../lib/components/FloatingCard';
import { triggerHaptic } from '../../../lib/utils/haptics';

type TabParamList = {
  Home: undefined;
  History: undefined;
  Profile: undefined;
};

type HomeStackParamList = {
  Dashboard: undefined;
  RecommendationType: { image: string };
  Analyzing: undefined;
  Results: { image: string; songs: any[]; imagePath?: string };
};

type HistoryStackParamList = {
  History: undefined;
  HistoryResults: { image: string; songs: any[]; historyItemId?: string; imagePath?: string };
};

type HistoryNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'History'>,
  NativeStackNavigationProp<HistoryStackParamList>
>;

type HistoryItem = {
  id: string;
  image_url: string;
  songs: any[];
  created_at: string;
};

const HistoryScreen = () => {
  const navigation = useNavigation<HistoryNavigationProp>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [imageUrls, setImageUrls] = useState<{ [key: string]: string }>({});
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const fetchHistory = async (showLoading: boolean = true) => {
    if (showLoading) {
      setLoading(true);
    }
    
    const { data, error } = await supabase
      .from('history')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('Error fetching history:', error);
      setHistory([]);
    } else {
      console.log('Fetched history items:', data?.length || 0);
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
    
    if (showLoading) {
      setLoading(false);
      
      // Animate in (only on initial load)
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  // Load history on mount with loading state
  useEffect(() => {
    fetchHistory(true); // Show loading on initial mount
  }, []);

  // Refresh history when screen comes into focus (without loading spinner)
  useFocusEffect(
    React.useCallback(() => {
      // Only refresh if not currently loading (avoid double fetch on mount)
      if (!loading) {
        fetchHistory(false); // Don't show loading spinner on refresh
      }
    }, [loading])
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      return 'Today';
    } else if (diffDays === 2) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays - 1} days ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const handleItemPress = (item: HistoryItem, currentImageUrl: string) => {
    triggerHaptic('light');
    navigation.navigate('HistoryResults', { 
      image: currentImageUrl || item.image_url,
      songs: item.songs,
      historyItemId: item.id,
      imagePath: item.image_url
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>History</Text>
        </View>
        <View style={styles.loadingContainer}>
          <Animatable.View
            animation="pulse"
            iterationCount="infinite"
            duration={2000}
            style={styles.loadingIconContainer}
          >
            <LinearGradient
              colors={[Colors.accent.blue + '30', Colors.accent.coral + '20']}
              style={styles.loadingIconGradient}
            >
              <MaterialCommunityIcons 
                name="music-note" 
                size={48} 
                color={Colors.accent.blue} 
              />
            </LinearGradient>
          </Animatable.View>
          <ActivityIndicator 
            size="large" 
            color={Colors.accent.blue} 
            style={styles.loadingSpinner}
          />
          <Text style={styles.loadingText}>Loading your history...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Animatable.View 
        animation="pulse" 
        iterationCount="infinite" 
        duration={2000}
        style={styles.emptyIconContainer}
      >
        <LinearGradient
          colors={[Colors.accent.blue + '30', Colors.accent.coral + '20']}
          style={styles.emptyIconGradient}
        >
          <MaterialCommunityIcons 
            name="music-note-outline" 
            size={64} 
            color={Colors.accent.blue} 
          />
        </LinearGradient>
      </Animatable.View>
      <Text style={styles.emptyTitle}>No History Yet</Text>
      <Text style={styles.emptySubtitle}>
        Start discovering your vibe by analyzing your first photo!
      </Text>
    </View>
  );

  const renderHistoryItem = ({ item, index }: { item: HistoryItem; index: number }) => {
    const currentImageUrl = imageUrls[item.id];
    const songCount = (item.songs || []).length;
    
    return (
      <Animatable.View
        animation="fadeInUp"
        duration={400}
        delay={index * 50}
      >
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => handleItemPress(item, currentImageUrl)}
          style={styles.itemContainer}
        >
          <FloatingCard style={styles.card}>
            {/* Gradient Accent */}
            <LinearGradient
              colors={[Colors.accent.blue + '15', Colors.accent.coral + '10', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardGradient}
            />
            
            <View style={styles.cardContent}>
              {/* Image Thumbnail */}
              <View style={styles.thumbnailContainer}>
                <Image 
                  source={{ uri: currentImageUrl || item.image_url }} 
                  style={styles.thumbnail}
                />
              </View>

              {/* Content */}
              <View style={styles.contentContainer}>
                {/* Header with Date */}
                <View style={styles.itemHeader}>
                  <View style={styles.dateContainer}>
                    <MaterialCommunityIcons 
                      name="clock-outline" 
                      size={14} 
                      color={Colors.textSecondary} 
                    />
                    <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
                  </View>
                  <View style={styles.songsBadge}>
                    <Text style={styles.songsBadgeText}>
                      {songCount} {songCount === 1 ? 'Song' : 'Songs'}
                    </Text>
                  </View>
                </View>

                {/* Songs List - Show All */}
                <View style={styles.songsList}>
                  {item.songs.map((song, idx) => (
                    <View key={idx} style={styles.songRow}>
                      <Text style={styles.songNumber}>{idx + 1}</Text>
                      <View style={styles.songInfo}>
                        <Text style={styles.songTitle} numberOfLines={1}>
                          {song.title}
                        </Text>
                        <Text style={styles.songArtist} numberOfLines={1}>
                          {song.artist}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Arrow Indicator */}
                <View style={styles.arrowContainer}>
                  <MaterialCommunityIcons 
                    name="chevron-right" 
                    size={24} 
                    color={Colors.textSecondary} 
                  />
                </View>
              </View>
            </View>
          </FloatingCard>
        </TouchableOpacity>
      </Animatable.View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
        <Text style={styles.headerTitle}>History</Text>
        <Text style={styles.headerSubtitle}>
          {history.length} {history.length === 1 ? 'item' : 'items'}
        </Text>
      </Animated.View>

      {history.length === 0 ? (
        renderEmptyState()
      ) : (
        <FlatList
          contentContainerStyle={styles.listContainer}
          data={history}
          keyExtractor={item => item.id}
          renderItem={renderHistoryItem}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh}
              tintColor={Colors.accent.blue}
              colors={[Colors.accent.blue]}
            />
          }
          showsVerticalScrollIndicator={false}
          ListFooterComponent={<View style={styles.footer} />}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerTitle: {
    ...Typography.heading1,
    fontSize: 32,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },
  headerSubtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Layout.screenPadding,
  },
  loadingIconContainer: {
    width: 100,
    height: 100,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
    ...Shadows.prominent,
  },
  loadingIconGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingSpinner: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  listContainer: { 
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  itemContainer: {
    marginBottom: 15,
  },
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  cardGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardContent: {
    flexDirection: 'row',
    paddingHorizontal: 3,
    paddingVertical: 0,
    position: 'relative',
    alignItems: 'center',
  },
  thumbnailContainer: {
    width: 98,
    height: 98,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    ...Shadows.card,
    marginLeft: -15,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.cardBackgroundSecondary,
  },
  contentContainer: {
    flex: 1,
    marginLeft: 8,
    minWidth: 0,
    justifyContent: 'flex-start',
    paddingTop: 0,
    paddingBottom: 0,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dateText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 11,
  },
  songsBadge: {
    backgroundColor: Colors.cardBackgroundSecondary,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: BorderRadius.round,
  },
  songsBadgeText: {
    ...Typography.caption,
    color: Colors.accent.blue,
    fontSize: 10,
    fontWeight: '600',
  },
  songsList: {
    flex: 1,
    justifyContent: 'flex-start',
    gap: 6,
    marginTop: 0,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 0,
  },
  songNumber: {
    ...Typography.caption,
    color: Colors.accent.blue,
    fontSize: 11,
    fontWeight: '700',
    width: 16,
    textAlign: 'center',
    marginTop: 0,
  },
  songInfo: {
    flex: 1,
    minWidth: 0,
  },
  songTitle: {
    ...Typography.caption,
    fontWeight: '600',
    fontSize: 12,
    color: Colors.textPrimary,
    marginBottom: 0,
    lineHeight: 0,
  },
  songArtist: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 11,
  },
  moreSongsText: {
    ...Typography.caption,
    color: Colors.accent.blue,
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
    marginLeft: 22,
  },
  arrowContainer: {
    position: 'absolute',
    right: -15 ,
    bottom: -15,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Layout.screenPadding,
    paddingVertical: Spacing.xxl,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
    ...Shadows.prominent,
  },
  emptyIconGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    ...Typography.heading2,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    height: Spacing.xl,
  },
});

export default HistoryScreen;