import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { OB } from './OnboardingChrome';
import { searchArtists } from '../taste';
import { triggerHaptic } from '../utils/haptics';

/**
 * The decades, newest first, as a vertical list.
 *
 * This was an arc with the decades spread around it. It looked like a control
 * but spent most of the screen to say seven words, and left no room to say
 * what any decade actually sounded like. A list fits the same seven choices
 * in less space and carries a face and a line of flavour on each one.
 */

// Newest first: most people are picking recent music, and it puts the
// likeliest taps nearest the thumb.
export const DECADES: readonly string[] = ['2020s', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s'];

const FLAVOUR: Record<string, string> = {
  '1960s': 'Motown, psychedelia, the British invasion',
  '1970s': 'Disco, punk, arena rock',
  '1980s': 'Synths, new wave, hair metal',
  '1990s': 'Grunge, Britpop, golden-age hip hop',
  '2000s': 'Garage rock, emo, R&B slow jams',
  '2010s': 'EDM, trap, indie pop',
  '2020s': 'Right now',
};

/**
 * One artist per decade, used only as the face on that row. Picked for
 * instant recognition rather than for being anyone's favourite, and fetched
 * from Spotify at runtime so no artwork ships in the bundle.
 */
const DECADE_FACES: Record<string, string> = {
  '1960s': 'The Beatles',
  '1970s': 'ABBA',
  '1980s': 'Michael Jackson',
  '1990s': 'Nirvana',
  '2000s': 'Beyonce',
  '2010s': 'Drake',
  '2020s': 'Billie Eilish',
};

// Resolved once per app run: this step is entered and left repeatedly while
// someone moves back and forth through the questions.
let faceCache: Record<string, string | null> | null = null;
let facePromise: Promise<Record<string, string | null>> | null = null;

async function loadDecadeFaces(): Promise<Record<string, string | null>> {
  if (faceCache) return faceCache;
  if (!facePromise) {
    facePromise = Promise.all(
      DECADES.map(async (decade) => {
        try {
          const [artist] = await searchArtists(DECADE_FACES[decade], { limit: 1 });
          return [decade, artist?.image ?? null] as const;
        } catch {
          return [decade, null] as const;
        }
      })
    )
      .then((pairs) => {
        faceCache = Object.fromEntries(pairs);
        return faceCache;
      })
      .finally(() => {
        facePromise = null;
      });
  }
  return facePromise;
}

const HINT_MS = 2200;

type Props = {
  value: readonly string[];
  max: number;
  onChange: (decades: string[]) => void;
};

export const DecadeDial: React.FC<Props> = ({ value, max, onChange }) => {
  const [faces, setFaces] = useState<Record<string, string | null>>(() => faceCache ?? {});
  const [full, setFull] = useState(false);
  const fullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (faceCache) return;
    let live = true;
    loadDecadeFaces()
      .then((f) => { if (live) setFaces(f); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => () => { if (fullTimer.current) clearTimeout(fullTimer.current); }, []);

  const toggle = (decade: string) => {
    if (value.includes(decade)) {
      triggerHaptic('light');
      onChange(value.filter((d) => d !== decade));
      return;
    }
    if (value.length >= max) {
      triggerHaptic('warning');
      setFull(true);
      if (fullTimer.current) clearTimeout(fullTimer.current);
      fullTimer.current = setTimeout(() => setFull(false), HINT_MS);
      return;
    }
    triggerHaptic('light');
    onChange([...value, decade]);
  };

  return (
    <View style={styles.list}>
      {full ? <Text style={styles.hint}>That's {max}. Tap one to remove it.</Text> : null}

      {DECADES.map((decade) => {
        const on = value.includes(decade);
        const face = faces[decade];
        return (
          <Pressable
            key={decade}
            onPress={() => toggle(decade)}
            style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${decade}. ${FLAVOUR[decade]}`}
          >
            <View style={[styles.faceWrap, on && styles.faceWrapOn]}>
              {face ? <Image source={{ uri: face }} style={styles.face} /> : null}
              {face && !on ? <View style={styles.faceVeil} /> : null}
            </View>

            <View style={styles.rowText}>
              <Text style={styles.decade}>{decade}</Text>
              <Text style={styles.flavour} numberOfLines={1}>
                {FLAVOUR[decade]}
              </Text>
            </View>

            <View style={[styles.check, on && styles.checkOn]}>
              {on ? <MaterialCommunityIcons name="check" size={15} color={OB.text} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  list: { paddingHorizontal: OB.margin, marginTop: 14, gap: 8 },
  hint: { color: OB.primary, fontSize: OB.caption, fontWeight: '600', marginBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: OB.surface,
    borderWidth: 1,
    borderColor: OB.border,
  },
  rowOn: { backgroundColor: 'rgba(244,37,140,0.14)', borderColor: OB.primary },
  rowPressed: { transform: [{ scale: 0.985 }] },
  faceWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  faceWrapOn: { borderColor: OB.primary },
  face: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  faceVeil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(34,16,25,0.35)' },
  rowText: { flex: 1, gap: 1 },
  decade: { color: OB.text, fontSize: 17, fontWeight: '700' },
  flavour: { color: OB.textFaint, fontSize: 12 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: OB.primary, borderColor: OB.primary },
});
