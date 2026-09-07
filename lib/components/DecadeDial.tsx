import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent, Pressable } from 'react-native';
import { OB } from './OnboardingChrome';
import { triggerHaptic } from '../utils/haptics';

/**
 * Decades on an arc, oldest on the left. Every stop is a toggle: tap to pick
 * or unpick it, or drag across several to pick them in one sweep. Up to
 * `max` at a time. A fixed card above the arc lists the picks and the
 * flavour of the one touched last, so nothing on the arc ever points at a
 * decade that is not picked.
 *
 * Geometry: a circle of radius R sits with its centre below the visible area,
 * so only the top of it shows. Stops spread over +-SPREAD degrees from
 * straight up.
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
const CARD_H = 76;
const RING_TOP = CARD_H + 26; // the card sits above the topmost stop
const HEIGHT = RING_TOP + 200;
const STOP = 18;
const STOP_ON = 30;
const HINT_MS = 2200;

type Props = {
  value: readonly string[];
  max: number;
  onChange: (decades: string[]) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const angleOf = (index: number) => -SPREAD_DEG + STEP_DEG * index;

export const DecadeDial: React.FC<Props> = ({ value, max, onChange }) => {
  const [width, setWidth] = useState(0);
  // The decade touched last, for the flavour line.
  const [last, setLast] = useState<string | null>(value[value.length - 1] ?? null);
  // Brief "that's three" message when a fourth pick is attempted.
  const [full, setFull] = useState(false);
  const fullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const valueRef = useRef<readonly string[]>(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => () => { if (fullTimer.current) clearTimeout(fullTimer.current); }, []);

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
        return { decade, x: cx + R * Math.sin(a), y: cy - R * Math.cos(a) };
      }),
    [cx, cy, R]
  );

  const indexAt = (pageX: number, pageY: number) => {
    const x = pageX - originRef.current.x;
    const y = pageY - originRef.current.y;
    const deg = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
    return clamp(Math.round((deg + SPREAD_DEG) / STEP_DEG), 0, DECADES.length - 1);
  };

  const flashFull = () => {
    triggerHaptic('warning');
    setFull(true);
    if (fullTimer.current) clearTimeout(fullTimer.current);
    fullTimer.current = setTimeout(() => setFull(false), HINT_MS);
  };

  // Pick a decade (never unpicks): used while sweeping.
  const pick = (i: number) => {
    const decade = DECADES[i];
    const cur = valueRef.current;
    if (cur.includes(decade)) return;
    if (cur.length >= max) {
      flashFull();
      return;
    }
    const next = [...cur, decade];
    valueRef.current = next;
    setLast(decade);
    triggerHaptic('light');
    onChange(next);
  };

  const toggle = (i: number) => {
    const decade = DECADES[i];
    const cur = valueRef.current;
    if (cur.includes(decade)) {
      const next = cur.filter((d) => d !== decade);
      valueRef.current = next;
      setLast(next[next.length - 1] ?? null);
      triggerHaptic('light');
      onChange(next);
      return;
    }
    pick(i);
  };

  // A touch is a tap until the finger crosses into another stop; from then
  // on it is a sweep that picks every stop it passes.
  const startRef = useRef<number | null>(null);
  const sweepRef = useRef(false);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (e) => {
          measure();
          startRef.current = indexAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
          sweepRef.current = false;
        },
        onPanResponderMove: (e) => {
          const i = indexAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
          if (startRef.current === null) return;
          if (!sweepRef.current) {
            if (i === startRef.current) return;
            // The sweep starts at the stop the finger landed on.
            sweepRef.current = true;
            pick(startRef.current);
          }
          pick(i);
        },
        onPanResponderRelease: () => {
          if (startRef.current !== null && !sweepRef.current) toggle(startRef.current);
          startRef.current = null;
          sweepRef.current = false;
        },
        onPanResponderTerminate: () => {
          startRef.current = null;
          sweepRef.current = false;
        },
      }),
    [cx, cy, R, max, onChange]
  );

  const sorted = DECADES.filter((d) => value.includes(d));
  const title = sorted.length > 0 ? sorted.join(' · ') : 'Tap up to three decades';
  const caption = full
    ? `That's ${max}. Tap one to remove it.`
    : sorted.length === 0
      ? 'Or drag across a few.'
      : FLAVOUR[last && value.includes(last) ? last : sorted[sorted.length - 1]];

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
          <View style={[styles.card, sorted.length > 0 && styles.cardOn]} pointerEvents="none">
            <Text style={[styles.cardTitle, sorted.length === 0 && styles.cardTitleEmpty]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.cardCaption, full && styles.cardCaptionFull]} numberOfLines={1}>
              {caption}
            </Text>
          </View>

          <View
            pointerEvents="none"
            style={[styles.ring, { width: R * 2, height: R * 2, borderRadius: R, left: cx - R, top: RING_TOP }]}
          />

          {stops.map((s, i) => {
            const on = value.includes(s.decade);
            const size = on ? STOP_ON : STOP;
            return (
              <React.Fragment key={s.decade}>
                <Pressable
                  // Touch is handled by the dial; this stays a Pressable so
                  // VoiceOver exposes each stop as a toggle.
                  onPress={() => toggle(i)}
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
                  style={[styles.label, on && styles.labelOn, { left: s.x - 30, top: s.y + 18 }]}
                >
                  {s.decade}
                </Text>
              </React.Fragment>
            );
          })}
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
  stopOn: {
    backgroundColor: OB.primary,
    borderWidth: 3,
    borderColor: OB.text,
    shadowColor: OB.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
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
    left: OB.margin,
    right: OB.margin,
    top: 0,
    minHeight: CARD_H,
    borderRadius: 14,
    backgroundColor: OB.surface,
    borderWidth: 1,
    borderColor: OB.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardOn: { backgroundColor: OB.surfaceRaised },
  cardTitle: { color: OB.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  cardTitleEmpty: { color: OB.textDim, fontSize: 17, fontWeight: '700' },
  cardCaption: { color: OB.textDim, fontSize: 12, lineHeight: 16, textAlign: 'center', marginTop: 4 },
  cardCaptionFull: { color: OB.primary, fontWeight: '600' },
});
