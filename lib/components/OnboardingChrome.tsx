import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Spacing } from '../designSystem';

/**
 * Shared chrome for the first-run flow (taste picker, photo and vibe).
 *
 * One header, one footer, one set of tokens, so the two steps read as one
 * flow: the same place for Back and Skip, the same progress bar, the same
 * primary button. Sentence case throughout, no decorative labels, every
 * tappable area at least 44pt.
 */
export const OB = {
  bg: '#221019',
  primary: '#f4258c',
  purple: '#8b5cf6',
  text: '#FFFFFF',
  textDim: 'rgba(255,255,255,0.62)',
  textFaint: 'rgba(255,255,255,0.38)',
  surface: 'rgba(255,255,255,0.06)',
  surfaceRaised: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.14)',
  track: 'rgba(255,255,255,0.14)',
  error: '#FF6B6B',
  // Type scale: one display size, one body, one caption.
  title: 28,
  body: 15,
  caption: 13,
  hit: 44,
};

type HeaderProps = {
  /** 1-based step shown in the progress bar. Omit to hide the bar. */
  step?: number;
  total?: number;
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
};

export const OnboardingHeader: React.FC<HeaderProps> = ({ step, total, onBack, onSkip, skipLabel = 'Skip' }) => {
  const showProgress = typeof step === 'number' && typeof total === 'number' && total > 0;
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={styles.iconBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <MaterialCommunityIcons name="chevron-left" size={28} color={OB.text} />
          </TouchableOpacity>
        ) : null}
      </View>

      {showProgress ? (
        <View
          style={styles.progress}
          accessibilityRole="progressbar"
          accessibilityLabel={`Step ${step} of ${total}`}
          accessibilityValue={{ min: 0, max: total, now: step }}
        >
          {Array.from({ length: total }).map((_, i) => (
            <View key={i} style={[styles.segment, i < (step ?? 0) && styles.segmentDone]} />
          ))}
        </View>
      ) : (
        <View style={styles.progress} />
      )}

      <View style={[styles.headerSide, styles.headerSideRight]}>
        {onSkip ? (
          <TouchableOpacity
            onPress={onSkip}
            style={styles.textBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={skipLabel}
          >
            <Text style={styles.textBtnLabel}>{skipLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

type FooterProps = {
  ctaLabel: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** One quiet line above the button: what is picked, or what is needed. */
  summary?: string | null;
  bottomInset?: number;
};

export const OnboardingFooter: React.FC<FooterProps> = ({
  ctaLabel,
  onPress,
  disabled,
  loading,
  summary,
  bottomInset = 0,
}) => {
  const inactive = !!disabled || !!loading;
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(bottomInset, Spacing.md) }]}>
      {summary ? (
        <Text style={styles.summary} numberOfLines={1}>
          {summary}
        </Text>
      ) : null}
      <TouchableOpacity
        style={[styles.cta, inactive && styles.ctaInactive]}
        onPress={onPress}
        disabled={inactive}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: inactive, busy: !!loading }}
      >
        {loading ? (
          <ActivityIndicator color={OB.text} />
        ) : (
          <>
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color={OB.text} />
          </>
        )}
      </TouchableOpacity>
    </View>
  );
};

/** Title and one-line explanation for a step. */
export const OnboardingIntro: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <View style={styles.intro}>
    <Text style={styles.title} accessibilityRole="header">{title}</Text>
    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    minHeight: OB.hit + 8,
  },
  headerSide: { width: 72, justifyContent: 'center' },
  headerSideRight: { alignItems: 'flex-end' },
  iconBtn: {
    width: OB.hit,
    height: OB.hit,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtn: {
    minHeight: OB.hit,
    paddingHorizontal: Spacing.sm,
    justifyContent: 'center',
  },
  textBtnLabel: { color: OB.textDim, fontSize: OB.body, fontWeight: '600' },
  progress: { flex: 1, flexDirection: 'row', gap: 6, paddingHorizontal: Spacing.md },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: OB.track },
  segmentDone: { backgroundColor: OB.primary },
  intro: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: 6 },
  title: {
    color: OB.text,
    fontSize: OB.title,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 34,
  },
  subtitle: { color: OB.textDim, fontSize: OB.body, lineHeight: 21 },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OB.border,
    backgroundColor: OB.bg,
    gap: Spacing.sm,
  },
  summary: { color: OB.textDim, fontSize: OB.caption, textAlign: 'center' },
  cta: {
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: OB.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaInactive: { opacity: 0.45 },
  ctaLabel: { color: OB.text, fontSize: 17, fontWeight: '700' },
});
