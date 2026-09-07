import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent, Animated, Pressable } from 'react-native';
import { OB } from './OnboardingChrome';
import { triggerHaptic } from '../utils/haptics';

/**
 * A slider along an arc: one knob, seven stops, oldest decade on the left.
 * Drag the knob or tap a stop; the decade under the knob is the pick. The
 * card above the knob names the decade and what it sounded like.
 *
 * Geometry: a circle of radius R sits with its centre below the visible area,
 * so only the top of it shows. Stops spread over +-SPREAD degrees from
 * straight up. The knob's position is an animated angle, mapped to x and y
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
const CARD_W = 150;
const CARD_H = 74;
const KNOB = 32;

type Props = {
  value: string | null;
  onChange: (decade: string) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const angleOf = (index: number) => -SPREAD_DEG + STEP_DEG * index;

export const DecadeDial: React.FC<Props> = ({ value, onChange }) => {
  const [width, setWidth] = useState(0);
  // The stop the knob is nearest to, for the card and the label emphasis.
  const [nearest, setNearest] = useState<number | null>(value ? DECADES.indexOf(value) : null);
  const [dragging, setDragging] = useState(false);
  const angle = useRef(new Animated.Value(value ? angleOf(DECADES.indexOf(value)) : 0)).current;
  const nearestRef = useRef<number | null>(nearest);

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
  const knobX = angle.interpolate({ inputRange: angleRange, outputRange: stops.map((s) => s.x - KNOB / 2), extrapolate: 'clamp' });
  const knobY = angle.interpolate({ inputRange: angleRange, outputRange: stops.map((s) => s.y - KNOB / 2), extrapolate: 'clamp' });
  const cardX = angle.interpolate({
    inputRange: angleRange,
    outputRange: stops.map((s) => clamp(s.x - CARD_W / 2, 4, Math.max(4, width - CARD_W - 4))),
    extrapolate: 'clamp',
  });
  const cardY = angle.interpolate({ inputRange: angleRange, outputRange: stops.map((s) => s.y - CARD_H - 24), extrapolate: 'clamp' });

  // Keep the knob on the parent's value when it changes from outside (a
  // restored profile arriving after mount).
  useEffect(() => {
    if (!value) return;
    const i = DECADES.indexOf(value);
    if (i < 0 || i === nearestRef.current) return;
    nearestRef.current = i;
    setNearest(i);
    Animated.spring(angle, { toValue: angleOf(i), useNativeDriver: false, tension: 90, friction: 11 }).start();
  }, [value, angle]);

  const touchAngle = (pageX: number, pageY: number) => {
    const x = pageX - originRef.current.x;
    const y = pageY - originRef.current.y;
    return clamp((Math.atan2(x - cx, cy - y) * 180) / Math.PI, -SPREAD_DEG, SPREAD_DEG);
  };
  const indexAt = (deg: number) => clamp(Math.round((deg + SPREAD_DEG) / STEP_DEG), 0, DECADES.length - 1);

  const settle = (i: number) => {
    Animated.spring(angle, { toValue: angleOf(i), useNativeDriver: false, tension: 90, friction: 11 }).start();
    if (i !== nearestRef.current) {
      nearestRef.current = i;
      setNearest(i);
    }
    triggerHaptic('light');
    onChange(DECADES[i]);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (e) => {
          measure();
          setDragging(true);
          const deg = touchAngle(e.nativeEvent.pageX, e.nativeEvent.pageY);
          const i = indexAt(deg);
          if (i !== nearestRef.current) {
            nearestRef.current = i;
            setNearest(i);
          }
          // Jump the knob under the finger straight away; springing to the
          // stop happens on release.
          Animated.spring(angle, { toValue: deg, useNativeDriver: false, tension: 120, friction: 12 }).start();
        },
        onPanResponderMove: (e) => {
          const deg = touchAngle(e.nativeEvent.pageX, e.nativeEvent.pageY);
          angle.setValue(deg);
          const i = indexAt(deg);
          if (i !== nearestRef.current) {
            nearestRef.current = i;
            setNearest(i);
            triggerHaptic('light');
          }
        },
        onPanResponderRelease: (e) => {
          setDragging(false);
          settle(indexAt(touchAngle(e.nativeEvent.pageX, e.nativeEvent.pageY)));
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          if (nearestRef.current !== null) settle(nearestRef.current);
        },
      }),
    [cx, cy, R, onChange]
  );

  const shown = nearest !== null ? DECADES[nearest] : null;

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
            const isNearest = i === nearest;
            return (
              <React.Fragment key={s.decade}>
                <Pressable
                  // Touch is handled by the dial; this stays a Pressable so
                  // VoiceOver exposes each stop as a button.
                  onPress={() => settle(i)}
                  style={[styles.stop, { left: s.x - 7, top: s.y - 7 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: value === s.decade }}
                  accessibilityLabel={`${s.decade}, decade`}
                />
                <Text
                  pointerEvents="none"
                  style={[styles.label, isNearest && styles.labelOn, { left: s.x - 30, top: s.y + 16 }]}
                >
                  {s.decade}
                </Text>
              </React.Fragment>
            );
          })}

          {shown ? (
            <>
              <Animated.View
                pointerEvents="none"
                style={[styles.knob, dragging && styles.knobDragging, { transform: [{ translateX: knobX }, { translateY: knobY }] }]}
              />
              <Animated.View
                pointerEvents="none"
                style={[styles.card, { transform: [{ translateX: cardX }, { translateY: cardY }] }]}
              >
                <Text style={styles.cardDecade}>{shown}</Text>
                <Text style={styles.cardFlavour} numberOfLines={2}>
                  {FLAVOUR[shown]}
                </Text>
              </Animated.View>
            </>
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
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: OB.bg,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
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
  knobDragging: { transform: [{ scale: 1.15 }] },
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
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  cardDecade: { color: OB.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  cardFlavour: { color: OB.textDim, fontSize: 11, lineHeight: 14, textAlign: 'center', marginTop: 2 },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: OB.textFaint,
    fontSize: OB.caption,
  },
});
