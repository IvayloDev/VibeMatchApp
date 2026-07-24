// Tap-to-play 30s preview button with a circular progress ring. Three shapes:
//  - 'hero'  : big red circle (main reveal card), ring wraps the circle
//  - 'pill'  : green "Play/Pause" pill + small Spotify icon; ring wraps the icon
//  - 'small' : compact icon + small Spotify icon (alternatives); ring wraps the icon
import React from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BorderRadius, Colors, Spacing, Typography } from '../designSystem';
import { triggerHaptic } from '../utils/haptics';
import { useTrackPreview } from '../trackPreview';
import { ProgressRing } from './ProgressRing';

// Spotify's official brand green — brighter than the app's muted accent so the
// button reads clearly against the dark cards.
const SPOTIFY_GREEN = '#1DB954';

type PreviewSong = {
  title: string;
  artist: string;
  preview_url?: string | null;
  spotify_url?: string;
};

export function TrackPreviewButton({
  song,
  variant,
}: {
  song: PreviewSong;
  variant: 'hero' | 'pill' | 'small';
}) {
  const { activeKey, status, progress, toggle } = useTrackPreview();
  const key = song.spotify_url || `${song.title}·${song.artist}`;
  const isActive = activeKey === key;
  const isLoading = isActive && status === 'loading';
  const isPlaying = isActive && status === 'playing';
  const showRing = isPlaying; // progress ring only while actually playing
  const icon = isPlaying ? 'pause' : 'play';

  const onPress = () => {
    triggerHaptic('medium');
    toggle(key, song);
  };

  const openSpotify = () => song.spotify_url && Linking.openURL(song.spotify_url);

  if (variant === 'hero') {
    return (
      <View style={styles.heroWrap}>
        {showRing ? (
          <ProgressRing size={72} stroke={3} progress={progress} color="#FFFFFF" trackColor="rgba(255,255,255,0.25)" />
        ) : null}
        <TouchableOpacity style={styles.hero} onPress={onPress} activeOpacity={0.8}>
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <MaterialCommunityIcons name={icon} size={28} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>
    );
  }

  if (variant === 'pill') {
    return (
      <View style={styles.pillRow}>
        <TouchableOpacity style={styles.pill} onPress={onPress} activeOpacity={0.85}>
          <View style={styles.iconWrap24}>
            {isLoading ? (
              <ActivityIndicator size="small" color={Colors.textPrimary} />
            ) : (
              <MaterialCommunityIcons name={icon} size={16} color={Colors.textPrimary} />
            )}
            {showRing ? (
              <ProgressRing size={24} stroke={2.5} progress={progress} color="rgba(255,255,255,0.95)" trackColor="rgba(255,255,255,0.3)" />
            ) : null}
          </View>
          <Text style={styles.pillText}>{isPlaying ? 'Pause' : isLoading ? 'Loading' : 'Play'}</Text>
        </TouchableOpacity>
        {song.spotify_url ? (
          <TouchableOpacity style={styles.spotifyIcon} onPress={openSpotify} hitSlop={10} activeOpacity={0.7}>
            <MaterialCommunityIcons name="spotify" size={34} color={SPOTIFY_GREEN} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // small
  return (
    <View style={styles.smallRow}>
      <View style={styles.smallWrap}>
        {showRing ? (
          <ProgressRing size={32} stroke={2.5} progress={progress} color={Colors.accent.green} trackColor={Colors.accent.green + '40'} />
        ) : null}
        <TouchableOpacity style={styles.smallBtn} onPress={onPress} activeOpacity={0.85}>
          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.accent.green} />
          ) : (
            <MaterialCommunityIcons name={icon} size={16} color={Colors.accent.green} />
          )}
        </TouchableOpacity>
      </View>
      {song.spotify_url ? (
        <TouchableOpacity onPress={openSpotify} hitSlop={10} style={styles.smallSpotify} activeOpacity={0.7}>
          <MaterialCommunityIcons name="spotify" size={30} color={SPOTIFY_GREEN} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.accent.green,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    minWidth: 92,
    justifyContent: 'center',
  },
  iconWrap24: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    ...Typography.button,
    color: Colors.textPrimary,
    marginLeft: Spacing.xs,
    fontSize: 14,
    fontWeight: '600',
  },
  spotifyIcon: {
    marginLeft: Spacing.sm,
    padding: Spacing.xs,
  },
  smallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  smallWrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.accent.green + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallSpotify: {
    marginLeft: Spacing.xs,
    padding: Spacing.xs,
  },
});
