import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { OB } from './OnboardingChrome';

/**
 * The genre step, as two columns of small cards.
 *
 * It was a wall of identical grey pills: twelve words on one ground, nothing
 * to look at and nothing to tell you what any of them meant. Each genre now
 * carries its own glyph in its own colour and a short line of what it sounds
 * like, which is the same anatomy as the decade rows one step earlier.
 *
 * Colour lives only in the 30pt glyph tile, never in the card behind it. A
 * grid of twenty-four coloured cards would be a rainbow, and it would fight
 * the pink that means "picked".
 */

type Meta = { icon: string; color: string; flavour: string };

// Every genre in the catalog, not only the eleven shown before "More", so the
// unfolded list looks like the same screen rather than a fallback.
const GENRE_META: Record<string, Meta> = {
  'pop': { icon: 'star-four-points', color: '#C084FC', flavour: 'Charts and hooks' },
  'hip hop': { icon: 'microphone', color: '#FBBF24', flavour: 'Beats and bars' },
  'r&b': { icon: 'heart-pulse', color: '#818CF8', flavour: 'Smooth and slow' },
  'rock': { icon: 'guitar-electric', color: '#F87171', flavour: 'Loud guitars' },
  'indie': { icon: 'album', color: '#34D399', flavour: 'Off the charts' },
  'electronic': { icon: 'waveform', color: '#22D3EE', flavour: 'Club synths' },
  'house': { icon: 'speaker', color: '#38BDF8', flavour: 'Deep dance beat' },
  'techno': { icon: 'sine-wave', color: '#7DD3FC', flavour: 'Hard, hypnotic' },
  'latin': { icon: 'fire', color: '#FB923C', flavour: 'Salsa to bachata' },
  'reggaeton': { icon: 'dance-ballroom', color: '#F97316', flavour: 'Dembow beat' },
  'afrobeats': { icon: 'earth', color: '#4ADE80', flavour: 'Lagos to London' },
  'k-pop': { icon: 'star', color: '#E879F9', flavour: 'Seoul pop' },
  'jazz': { icon: 'saxophone', color: '#60A5FA', flavour: 'Horns and swing' },
  'soul': { icon: 'heart', color: '#E8836F', flavour: 'Motown warmth' },
  'funk': { icon: 'guitar-pick', color: '#F59E0B', flavour: 'Bass and groove' },
  'country': { icon: 'guitar-acoustic', color: '#D6A265', flavour: 'Twang and tales' },
  'folk': { icon: 'campfire', color: '#A3B18A', flavour: 'Acoustic, honest' },
  'classical': { icon: 'music-clef-treble', color: '#E7E5E4', flavour: 'Strings, scores' },
  'lo-fi': { icon: 'headphones', color: '#94A3B8', flavour: 'Soft loops' },
  'ambient': { icon: 'weather-night', color: '#A5B4FC', flavour: 'No hurry' },
  'metal': { icon: 'flash', color: '#A1A1AA', flavour: 'Heavy and fast' },
  'punk': { icon: 'skull', color: '#FF6B35', flavour: 'Fast and loud' },
  'reggae': { icon: 'palm-tree', color: '#22C55E', flavour: 'Offbeat and easy' },
  'dancehall': { icon: 'boombox', color: '#FB7185', flavour: 'Riddim bounce' },
};

// A genre restored from an older profile can be outside the catalog. It still
// gets a card, just a neutral one.
const FALLBACK: Meta = { icon: 'music-note', color: '#B8A9B2', flavour: '' };

// "hip hop" -> "Hip Hop", "r&b" -> "R&B"
const formatGenre = (genre: string) =>
  genre.replace(/(^|[\s&-])([a-z])/g, (_m, lead: string, letter: string) => lead + letter.toUpperCase());

// The glyph tile: the genre's colour at 20% behind the icon in full colour.
const tint = (hex: string) => hex + '33';

type Props = {
  options: readonly string[];
  value: readonly string[];
  onToggle: (genre: string) => void;
  /** Shown as a final "More" card when the list is still folded. */
  hiddenCount?: number;
  onMore?: () => void;
};

export const GenreGrid: React.FC<Props> = ({ options, value, onToggle, hiddenCount = 0, onMore }) => (
  <View style={styles.grid}>
    {options.map((genre) => {
      const meta = GENRE_META[genre] ?? FALLBACK;
      const on = value.includes(genre);
      const name = formatGenre(genre);
      return (
        <Pressable
          key={genre}
          onPress={() => onToggle(genre)}
          style={({ pressed }) => [styles.card, on && styles.cardOn, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityState={{ selected: on }}
          accessibilityLabel={meta.flavour ? `${name}. ${meta.flavour}` : name}
        >
          <View style={styles.glyphWrap}>
            <View style={[styles.glyph, { backgroundColor: tint(meta.color) }]}>
              <MaterialCommunityIcons name={meta.icon as any} size={17} color={meta.color} />
            </View>
            {on ? (
              <View style={styles.badge}>
                <MaterialCommunityIcons name="check" size={11} color={OB.text} />
              </View>
            ) : null}
          </View>

          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            {meta.flavour ? (
              <Text style={styles.flavour} numberOfLines={1}>{meta.flavour}</Text>
            ) : null}
          </View>
        </Pressable>
      );
    })}

    {hiddenCount > 0 && onMore ? (
      <Pressable
        onPress={onMore}
        style={({ pressed }) => [styles.card, styles.cardMore, pressed && styles.cardPressed]}
        accessibilityRole="button"
        accessibilityLabel={`More genres, ${hiddenCount} hidden`}
      >
        <View style={styles.glyphWrap}>
          <View style={[styles.glyph, styles.glyphMore]}>
            <MaterialCommunityIcons name="dots-horizontal" size={17} color={OB.textDim} />
          </View>
        </View>
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>More</Text>
          <Text style={styles.flavour} numberOfLines={1}>{hiddenCount} others</Text>
        </View>
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: OB.margin,
    marginTop: 14,
  },
  card: {
    // Two per row: a basis under half leaves room for the gap, and growing
    // fills the rest. A lone odd card stays half width instead of stretching
    // across the screen.
    flexBasis: '46%',
    flexGrow: 1,
    maxWidth: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: OB.surface,
    borderWidth: 1,
    borderColor: OB.border,
  },
  cardOn: { backgroundColor: 'rgba(244,37,140,0.14)', borderColor: OB.primary },
  cardMore: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  cardPressed: { transform: [{ scale: 0.985 }] },
  glyphWrap: { width: 32, height: 32 },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphMore: { backgroundColor: 'rgba(255,255,255,0.06)' },
  badge: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: OB.primary,
    borderWidth: 2,
    borderColor: OB.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 1 },
  name: { color: OB.text, fontSize: 15, fontWeight: '700' },
  flavour: { color: OB.textFaint, fontSize: 11 },
});
