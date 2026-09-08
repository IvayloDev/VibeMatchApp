/**
 * The out-of-matches pitch, inline rather than as a modal.
 *
 * Two surfaces use it: the Results screen, right under a match somebody is
 * still enjoying, and Discover, as the content of the empty state.
 *
 * Deliberately NOT a dialog. Selling by interrupting navigation punishes the
 * moment of delight - tapping Vault after a match is somebody going to look at
 * the thing they just made - and a modal that says "come back tomorrow" right
 * after a paywall is permission not to buy. This says both things once, in
 * place, and the buying still happens through WallSheet so there remains one
 * purchase implementation.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatUntil } from '../dailyCredit';

type Props = {
  /** When the next free match lands, from the server. */
  nextFreeAt: Date | null;
  onBuy: () => void;
  /** 'results' sells; 'discover' is the empty state and leads with the wait. */
  variant?: 'results' | 'discover';
  style?: any;
};

export default function OutOfMatchesCard({ nextFreeAt, onBuy, variant = 'results', style }: Props) {
  const waitText = nextFreeAt ? `Your next free match lands in ${formatUntil(nextFreeAt)}` : null;

  return (
    <View style={[styles.card, style]}>
      <View style={styles.headRow}>
        <MaterialCommunityIcons
          name={variant === 'results' ? 'music-note' : 'clock-outline'}
          size={18}
          color="#FF4F8B"
        />
        <Text style={styles.title}>
          {variant === 'results' ? 'That was your last match' : 'No matches left'}
        </Text>
      </View>

      {/* The free match first, always. It is true, it is the reason to come
          back, and hiding it to push a sale is how an app stops being trusted. */}
      {waitText ? <Text style={styles.wait}>{waitText}</Text> : null}

      <Text style={styles.body}>
        {variant === 'results'
          ? "Or keep going now - five more matches for the price of a coffee."
          : "Grab five more and keep matching, or wait for tomorrow's free one."}
      </Text>

      <Pressable style={styles.cta} onPress={onBuy} accessibilityRole="button">
        <Text style={styles.ctaText}>Get 5 more matches</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,79,139,0.28)',
    paddingVertical: 18,
    paddingHorizontal: 18,
    gap: 8,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  wait: { color: '#FF9BC2', fontSize: 13, fontWeight: '600' },
  body: { color: 'rgba(255,255,255,0.66)', fontSize: 14, lineHeight: 20 },
  cta: {
    marginTop: 6,
    backgroundColor: '#FF4F8B',
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
