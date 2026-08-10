// Tap-to-play 30s preview button with a circular progress ring. Three shapes:
//  - 'hero'  : big red circle (main reveal card), ring wraps the circle
//  - 'pill'  : green "Play/Pause" pill + streaming links; ring wraps the icon
//  - 'small' : compact icon + streaming links (alternatives); ring wraps the icon
import React from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BorderRadius, Colors, Spacing, Typography } from '../designSystem';
import { triggerHaptic } from '../utils/haptics';
import { useTrackPreview } from '../trackPreview';
import { useAppleMusicUrl } from '../appleMusic';
import { trackEvent } from '../posthog';
import { ProgressRing } from './ProgressRing';

// Spotify's official brand green — brighter than the app's muted accent so the
// button reads clearly against the dark cards.
const SPOTIFY_GREEN = '#1DB954';
// Apple Music's brand red.
const APPLE_MUSIC_RED = '#FA243C';

type PreviewSong = {
  title: string;
  artist: string;
  preview_url?: string | null;
  spotify_url?: string;
};

/**
 * "Open in <service>" links for a track. Results are resolved against Spotify
 * by the recommendation pipeline, so Spotify is always there when the resolver
 * matched; the Apple Music link is looked up client-side and simply omitted
 * when the track has no Apple match.
 */
function StreamingLinks({
  song,
  size,
  variant,
  gap = Spacing.xs,
}: {
  song: PreviewSong;
  size: number;
  variant: string;
  gap?: number;
}) {
  const appleUrl = useAppleMusicUrl(song);

  const open = (service: 'spotify' | 'apple_music', url: string) => {
    triggerHaptic('light');
    trackEvent(service === 'spotify' ? 'spotify_opened' : 'apple_music_opened', {
      variant,
      had_alternative: service === 'spotify' ? !!appleUrl : !!song.spotify_url,
    });
    Linking.openURL(url);
  };

  if (!song.spotify_url && !appleUrl) return null;

  return (
    <View style={[styles.linksRow, { gap }]}>
      {song.spotify_url ? (
        <TouchableOpacity
          onPress={() => open('spotify', song.spotify_url!)}
          hitSlop={10}
          activeOpacity={0.7}
          accessibilityLabel="Open in Spotify"
        >
          <MaterialCommunityIcons name="spotify" size={size} color={SPOTIFY_GREEN} />
        </TouchableOpacity>
      ) : null}
      {appleUrl ? (
        <TouchableOpacity
          onPress={() => open('apple_music', appleUrl)}
          hitSlop={10}
          activeOpacity={0.7}
          accessibilityLabel="Open in Apple Music"
        >
          <MaterialCommunityIcons name="apple" size={size} color={APPLE_MUSIC_RED} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function TrackPreviewButton({
  song,
  variant,
}: {
  song: PreviewSong;
  variant: 'hero' | 'pill' | 'small';
}) {
  const { activeKey, status, progress, availability, checkAvailability, toggle } = useTrackPreview();
  const key = song.spotify_url || `${song.title}·${song.artist}`;

  // Resolve preview availability up front so we can hide the play button for
  // tracks that genuinely cannot be previewed, rather than opening Spotify.
  React.useEffect(() => {
    checkAvailability(key, song);
  }, [key]);

  const canPreview = availability[key] !== 'unavailable';
  const isActive = activeKey === key;
  const isLoading = isActive && status === 'loading';
  const isPlaying = isActive && status === 'playing';
  const showRing = isPlaying; // progress ring only while actually playing
  const icon = isPlaying ? 'pause' : 'play';

  const onPress = () => {
    triggerHaptic('medium');
    toggle(key, song);
  };

  // Track can't be previewed: drop the play button entirely and put the
  // streaming links in its place, so tapping "play" never silently launches
  // another app.
  if (!canPreview) {
    if (variant === 'hero') {
      return (
        <View style={styles.heroWrap}>
          <StreamingLinks song={song} size={48} variant={variant} gap={Spacing.sm} />
        </View>
      );
    }
    if (variant === 'pill') {
      return (
        <View style={styles.pillRow}>
          <StreamingLinks song={song} size={38} variant={variant} gap={Spacing.sm} />
        </View>
      );
    }
    return (
      <View style={styles.smallRow}>
        <StreamingLinks song={song} size={28} variant={variant} />
      </View>
    );
  }

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
        <View style={styles.linksAfterPill}>
          <StreamingLinks song={song} size={32} variant={variant} gap={Spacing.sm} />
        </View>
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
      <View style={styles.smallLinks}>
        <StreamingLinks song={song} size={26} variant={variant} />
      </View>
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
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  linksAfterPill: {
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
  smallLinks: {
    marginLeft: Spacing.xs,
    padding: Spacing.xs,
  },
});
