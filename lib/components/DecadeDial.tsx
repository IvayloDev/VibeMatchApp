import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent, Pressable } from 'react-native';
import { OB } from './OnboardingChrome';
import { triggerHaptic } from '../utils/haptics';

/**
 * Decades on an arc, oldest on the left, newest on the right. Drag along the
 * arc or tap a stop. Tapping a lit stop clears it; up to three stay lit. The
 * stop you touched last lifts a card that names the decade and what it
 * sounded like.
 *
 * Geometry: a circle of radius R sits with its centre below the visible area,
 * so only the top of it shows. Stops are spread over +-SPREAD degrees from
 * straight up, so the arc spans the width without any label clipping.
 */

// Oldest first: a timeline reads left to right.
const DECADES: readonly string[] = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

const FLAVOUR: Record<string, string> = {
  '1960s': 'Motown, psychedelia, the British invasion',
  '1970s': 'Disco, punk, arena rock',
  '1980s': 'Synths, new wave, hair metal',
  '1990s': 'Grunge, Britpop, golden-age hip hop',
  '2000s': 'Garage rock, emo, R&B slow jams',
  '2010s': 'EDM, trap, indie pop',
  '2020s': 'Right now',
};

const SPREAD_DEG = 54;
const STEP_DEG = (SPREAD_DEG * 2) / (DECADES.length - 1);
const TRACK = 10;
const HEIGHT = 290;
const RING_TOP = 72; // room for the lifted card above the topmost stop
const CARD_W = 140;
const CARD_H = 74;

type Props = {
  selected: string[];
  onToggle: (decade: string) => void;
};

export const DecadeDial: React.FC<Props> = ({ selected, onToggle }) => {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<string | null>(() => selected[selected.length - 1] ?? null);
  // The stop the finger is over mid-drag, so the card follows the drag.
  const [hover, setHover] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  // Touches arrive with pageX/pageY; the wrap's window origin turns them into
  // dial coordinates. locationX/Y would be relative to whichever child was
  // hit, which put taps on a stop at the wrong angle.
  const wrapRef = useRef<View>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const measure = () => {
    wrapRef.current?.measureInWindow((x, y) => {
      originRef.current = { x, y };
    });
  };

  const R = Math.round(width * 0.535);
  const cx = width / 2;
  const cy = RING_TOP + R;

  const stops = useMemo(
    () =>
      DECADES.map((decade, i) => {
        const a = ((-SPREAD_DEG + STEP_DEG * i) * Math.PI) / 180;
        return { decade, x: cx + R * Math.sin(a), y: cy - R * Math.cos(a) };
      }),
    [cx, cy, R]
  );

  const indexAt = (x: number, y: number) => {
    const deg = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
    return Math.max(0, Math.min(DECADES.length - 1, Math.round((deg + SPREAD_DEG) / STEP_DEG)));
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        // The dial owns every touch inside it, so a tap on a stop is one
        // grant and one release, never a press plus a pan.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (e) => {
          measure();
          const i = indexAt(e.nativeEvent.pageX - originRef.current.x, e.nativeEvent.pageY - originRef.current.y);
          hoverRef.current = i;
          setHover(i);
        },
        onPanResponderMove: (e) => {
          const i = indexAt(e.nativeEvent.pageX - originRef.current.x, e.nativeEvent.pageY - originRef.current.y);
          if (i !== hoverRef.current) {
            hoverRef.current = i;
            setHover(i);
            triggerHaptic('light');
          }
        },
        onPanResponderRelease: () => {
          const i = hoverRef.current;
          hoverRef.current = null;
          setHover(null);
          if (i === null) return;
          const decade = DECADES[i];
          setActive(decade);
          onToggle(decade);
        },
        onPanResponderTerminate: () => {
          hoverRef.current = null;
          setHover(null);
        },
      }),
    // indexAt closes over the layout; rebuild when it changes.
    [cx, cy, R, onToggle]
  );

  const shown = hover !== null ? DECADES[hover] : active;
  const shownStop = stops.find((s) => s.decade === shown);
  const cardLeft = shownStop ? Math.max(4, Math.min(width - CARD_W - 4, shownStop.x - CARD_W / 2)) : 0;

  return (
    <View
      ref={wrapRef}
      style={styles.wrap}
      onLayout={(e: LayoutChangeEvent) => {
        setWidth(e.nativeEvent.layout.width);
        measure();
      }}
      {...pan.panHandlers}
      accessible={false}
    >
      {width > 0 ? (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.ring,
              { width: R * 2, height: R * 2, borderRadius: R, left: cx - R, top: RING_TOP },
            ]}
          />

          {stops.map((s, i) => {
            const on = selected.includes(s.decade);
            const isShown = s.decade === shown;
            const size = isShown ? 28 : 18;
            return (
              <React.Fragment key={s.decade}>
                {isShown ? (
                  <View pointerEvents="none" style={[styles.halo, { left: s.x - 22, top: s.y - 22 }]} />
                ) : null}
                <Pressable
                  // Touch is handled by the dial; this stays a Pressable so
                  // VoiceOver exposes each stop as a button.
                  onPress={() => {
                    setActive(s.decade);
                    onToggle(s.decade);
                  }}
                  style={[
                    styles.stop,
                    on && styles.stopOn,
                    { width: size, height: size, borderRadius: size / 2, left: s.x - size / 2, top: s.y - size / 2 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${s.decade}, decade`}
                />
                <Text
                  pointerEvents="none"
                  style={[styles.label, on && styles.labelOn, { left: s.x - 30, top: s.y + 16 }]}
                >
                  {s.decade}
                </Text>
              </React.Fragment>
            );
          })}

          {shownStop ? (
            <View pointerEvents="none" style={[styles.card, { left: cardLeft, top: shownStop.y - CARD_H - 22 }]}>
              <Text style={styles.cardDecade}>{shownStop.decade}</Text>
              <Text style={styles.cardFlavour} numberOfLines={2}>
                {FLAVOUR[shownStop.decade]}
              </Text>
              <View style={[styles.cardTail, { left: shownStop.x - cardLeft - 6 }]} />
            </View>
          ) : (
            <Text pointerEvents="none" style={[styles.hint, { top: RING_TOP - 46 }]}>
              Drag along the arc, or tap a decade
            </Text>
          )}
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { height: HEIGHT, overflow: 'hidden', marginTop: 8 },
  ring: {
    position: 'absolute',
    borderWidth: TRACK,
    borderColor: OB.track,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  stop: {
    position: 'absolute',
    backgroundColor: OB.bg,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  stopOn: { backgroundColor: OB.primary, borderColor: OB.text },
  halo: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(244,37,140,0.22)',
  },
  label: {
    position: 'absolute',
    width: 60,
    textAlign: 'center',
    color: OB.textFaint,
    fontSize: 12,
    fontWeight: '600',
  },
  labelOn: { color: OB.text },
  card: {
    position: 'absolute',
    width: CARD_W,
    minHeight: CARD_H,
    borderRadius: 14,
    backgroundColor: OB.surfaceRaised,
    borderWidth: 1,
    borderColor: OB.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  cardDecade: { color: OB.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  cardFlavour: { color: OB.textDim, fontSize: 11, lineHeight: 14, textAlign: 'center', marginTop: 2 },
  cardTail: {
    position: 'absolute',
    bottom: -7,
    width: 12,
    height: 12,
    backgroundColor: OB.surfaceRaised,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: OB.border,
    transform: [{ rotate: '45deg' }],
  },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: OB.textFaint,
    fontSize: OB.caption,
  },
});
