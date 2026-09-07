import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent, Animated, Pressable } from 'react-native';
import { OB } from './OnboardingChrome';
import { triggerHaptic } from '../utils/haptics';

/**
 * A range slider along an arc: two knobs, seven stops, oldest decade on the
 * left. Drag either knob or tap a stop; every decade between the knobs is
 * picked, up to MAX_SPAN of them. With both knobs on one stop it is a single
 * decade. The card above the range names it and what it sounded like.
 *
 * Geometry: a circle of radius R sits with its centre below the visible area,
 * so only the top of it shows. Stops spread over +-SPREAD degrees from
 * straight up. Each knob's position is an animated angle mapped to x and y
 * piecewise between the stops, so it can spring from one stop to the next.
 */

// Oldest first: a timeline reads left to right.
export const DECADES: readonly string[] = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

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
const HEIGHT = 310;
const RING_TOP = 112; // room for the card above the topmost stop
const CARD_W = 176;
const CARD_H = 74;
const KNOB = 30;

type Props = {
  /** Picked decades, contiguous. Empty means nothing picked yet. */
  value: readonly string[];
  /** How many decades the range may cover. */
  maxSpan: number;
  onChange: (decades: string[]) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const angleOf = (index: number) => -SPREAD_DEG + STEP_DEG * index;
const springTo = (v: Animated.Value, to: number) =>
  Animated.spring(v, { toValue: to, useNativeDriver: false, tension: 90, friction: 11 }).start();

// The picked decades as a [first, last] index pair, or null when empty.
const boundsOf = (value: readonly string[]): [number, number] | null => {
  const idx = value.map((d) => DECADES.indexOf(d)).filter((i) => i >= 0);
  if (idx.length === 0) return null;
  return [Math.min(...idx), Math.max(...idx)];
};

export const DecadeDial: React.FC<Props> = ({ value, maxSpan, onChange }) => {
  const [width, setWidth] = useState(0);
  const initial = boundsOf(value);
  // Stop indices the two knobs sit on (or are heading to). Null = untouched.
  const [range, setRange] = useState<[number, number] | null>(initial);
  const rangeRef = useRef<[number, number] | null>(initial);
  // Which knob the finger holds during a drag.
  const [held, setHeld] = useState<0 | 1 | null>(null);
  const heldRef = useRef<0 | 1 | null>(null);
  const angles = useRef([
    new Animated.Value(initial ? angleOf(initial[0]) : 0),
    new Animated.Value(initial ? angleOf(initial[1]) : 0),
  ]).current;

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
        const a = (angleOf(i) * Math.PI) / 180;
        return { decade, angle: angleOf(i), x: cx + R * Math.sin(a), y: cy - R * Math.cos(a) };
      }),
    [cx, cy, R]
  );

  // Angle -> position, piecewise between stops. Close enough to the arc.
  const angleRange = stops.map((s) => s.angle);
  const knobX = (a: Animated.Value) =>
    a.interpolate({ inputRange: angleRange, outputRange: stops.map((s) => s.x - KNOB / 2), extrapolate: 'clamp' });
  const knobY = (a: Animated.Value) =>
    a.interpolate({ inputRange: angleRange, outputRange: stops.map((s) => s.y - KNOB / 2), extrapolate: 'clamp' });
  // The card hangs over the middle of the range.
  const mid = Animated.divide(Animated.add(angles[0], angles[1]), 2);
  const cardX = mid.interpolate({
    inputRange: angleRange,
    outputRange: stops.map((s) => clamp(s.x - CARD_W / 2, 4, Math.max(4, width - CARD_W - 4))),
    extrapolate: 'clamp',
  });
  const cardY = mid.interpolate({
    inputRange: angleRange,
    outputRange: stops.map((s) => s.y - CARD_H - 26),
    extrapolate: 'clamp',
  });

  const commit = (next: [number, number]) => {
    rangeRef.current = next;
    setRange(next);
    onChange(DECADES.slice(next[0], next[1] + 1) as string[]);
  };

  // Follow the parent's value when it changes from outside (a restored
  // profile arriving after mount).
  useEffect(() => {
    const b = boundsOf(value);
    if (!b) return;
    const cur = rangeRef.current;
    if (cur && cur[0] === b[0] && cur[1] === b[1]) return;
    rangeRef.current = b;
    setRange(b);
    springTo(angles[0], angleOf(b[0]));
    springTo(angles[1], angleOf(b[1]));
  }, [value, angles]);

  const touchAngle = (pageX: number, pageY: number) => {
    const x = pageX - originRef.current.x;
    const y = pageY - originRef.current.y;
    return clamp((Math.atan2(x - cx, cy - y) * 180) / Math.PI, -SPREAD_DEG, SPREAD_DEG);
  };
  const indexAt = (deg: number) => clamp(Math.round((deg + SPREAD_DEG) / STEP_DEG), 0, DECADES.length - 1);

  // Where a knob may go: never past its partner, never wider than maxSpan.
  const limitFor = (knob: 0 | 1, cur: [number, number]): [number, number] =>
    knob === 0
      ? [Math.max(0, cur[1] - (maxSpan - 1)), cur[1]]
      : [cur[0], Math.min(DECADES.length - 1, cur[0] + (maxSpan - 1))];

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (e) => {
          measure();
          const deg = touchAngle(e.nativeEvent.pageX, e.nativeEvent.pageY);
          const i = indexAt(deg);
          const cur = rangeRef.current;
          if (!cur) {
            // First touch: both knobs land on this stop.
            angles[0].setValue(deg);
            angles[1].setValue(deg);
            heldRef.current = 1;
            setHeld(1);
            commit([i, i]);
            triggerHaptic('light');
            return;
          }
          // Grab the knob nearer to the finger; ties go to the one that lets
          // the range grow in the direction of the touch.
          const dLo = Math.abs(deg - angleOf(cur[0]));
          const dHi = Math.abs(deg - angleOf(cur[1]));
          const knob: 0 | 1 = dLo < dHi ? 0 : dLo > dHi ? 1 : deg < angleOf(cur[0]) ? 0 : 1;
          heldRef.current = knob;
          setHeld(knob);
          const [lo, hi] = limitFor(knob, cur);
          Animated.spring(angles[knob], {
            toValue: clamp(deg, angleOf(lo), angleOf(hi)),
            useNativeDriver: false,
            tension: 120,
            friction: 12,
          }).start();
          const ni = clamp(i, lo, hi);
          if (ni !== cur[knob]) {
            const next: [number, number] = knob === 0 ? [ni, cur[1]] : [cur[0], ni];
            rangeRef.current = next;
            setRange(next);
          }
        },
        onPanResponderMove: (e) => {
          const knob = heldRef.current;
          const cur = rangeRef.current;
          if (knob === null || !cur) return;
          const [lo, hi] = limitFor(knob, cur);
          const deg = clamp(touchAngle(e.nativeEvent.pageX, e.nativeEvent.pageY), angleOf(lo), angleOf(hi));
          angles[knob].setValue(deg);
          const ni = indexAt(deg);
          if (ni !== cur[knob]) {
            const next: [number, number] = knob === 0 ? [ni, cur[1]] : [cur[0], ni];
            rangeRef.current = next;
            setRange(next);
            triggerHaptic('light');
          }
        },
        onPanResponderRelease: () => {
          const knob = heldRef.current;
          const cur = rangeRef.current;
          heldRef.current = null;
          setHeld(null);
          if (knob === null || !cur) return;
          springTo(angles[knob], angleOf(cur[knob]));
          triggerHaptic('light');
          commit(cur);
        },
        onPanResponderTerminate: () => {
          const knob = heldRef.current;
          const cur = rangeRef.current;
          heldRef.current = null;
          setHeld(null);
          if (knob !== null && cur) springTo(angles[knob], angleOf(cur[knob]));
        },
      }),
    [cx, cy, R, onChange, maxSpan]
  );

  const single = range && range[0] === range[1];
  const title = !range ? null : single ? DECADES[range[0]] : `${DECADES[range[0]]} to ${DECADES[range[1]]}`;
  const caption = !range
    ? null
    : single
      ? FLAVOUR[DECADES[range[0]]]
      : `${range[1] - range[0] + 1} decades. Drag a knob to change the span.`;

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
            style={[styles.ring, { width: R * 2, height: R * 2, borderRadius: R, left: cx - R, top: RING_TOP }]}
          />

          {stops.map((s, i) => {
            const inRange = !!range && i >= range[0] && i <= range[1];
            return (
              <React.Fragment key={s.decade}>
                <Pressable
                  // Touch is handled by the dial; this stays a Pressable so
                  // VoiceOver exposes each stop as a button.
                  onPress={() => {
                    const cur = rangeRef.current;
                    if (!cur) {
                      springTo(angles[0], angleOf(i));
                      springTo(angles[1], angleOf(i));
                      commit([i, i]);
                      return;
                    }
                    const knob: 0 | 1 = Math.abs(i - cur[0]) <= Math.abs(i - cur[1]) ? 0 : 1;
                    const [lo, hi] = limitFor(knob, cur);
                    const ni = clamp(i, lo, hi);
                    springTo(angles[knob], angleOf(ni));
                    commit(knob === 0 ? [ni, cur[1]] : [cur[0], ni]);
                  }}
                  style={[styles.stop, inRange && styles.stopOn, { left: s.x - 8, top: s.y - 8 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: inRange }}
                  accessibilityLabel={`${s.decade}, decade`}
                />
                <Text
                  pointerEvents="none"
                  style={[styles.label, inRange && styles.labelOn, { left: s.x - 30, top: s.y + 16 }]}
                >
                  {s.decade}
                </Text>
              </React.Fragment>
            );
          })}

          {range ? (
            <>
              {([0, 1] as const).map((k) => (
                <Animated.View
                  key={k}
                  pointerEvents="none"
                  style={[
                    styles.knob,
                    held === k && styles.knobHeld,
                    { transform: [{ translateX: knobX(angles[k]) }, { translateY: knobY(angles[k]) }] },
                  ]}
                />
              ))}
              <Animated.View
                pointerEvents="none"
                style={[styles.card, { transform: [{ translateX: cardX }, { translateY: cardY }] }]}
              >
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={styles.cardCaption} numberOfLines={2}>
                  {caption}
                </Text>
              </Animated.View>
            </>
          ) : (
            <Text pointerEvents="none" style={[styles.hint, { top: RING_TOP - 46 }]}>
              Tap a decade, then drag the ends to widen
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
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: OB.bg,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  stopOn: { backgroundColor: OB.primary, borderColor: OB.primary },
  label: {
    position: 'absolute',
    width: 60,
    textAlign: 'center',
    color: OB.textFaint,
    fontSize: 12,
    fontWeight: '600',
  },
  labelOn: { color: OB.text },
  knob: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: OB.primary,
    borderWidth: 3,
    borderColor: OB.text,
    shadowColor: OB.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  knobHeld: { transform: [{ scale: 1.15 }] },
  card: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CARD_W,
    minHeight: CARD_H,
    borderRadius: 14,
    backgroundColor: OB.surfaceRaised,
    borderWidth: 1,
    borderColor: OB.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  cardTitle: { color: OB.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  cardCaption: { color: OB.textDim, fontSize: 11, lineHeight: 14, textAlign: 'center', marginTop: 2 },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: OB.textFaint,
    fontSize: OB.caption,
  },
});
