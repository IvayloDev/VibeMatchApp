import React from 'react';
import { View, Text, Pressable, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Spacing } from '../designSystem';

/**
 * Shared chrome and tokens for the first-run flow (Welcome, taste picker,
 * photo and vibe).
 *
 * One header, one footer, one chip, one button, so the steps read as one
 * flow: Back and Skip in the same place, the same progress bar, the same
 * 56pt pink pill. Pink means "selected" or "go" and nothing else; purple is
 * reserved for "what we already know about you" (the taste chip); teal marks
 * "done" and "at the limit". Sentence case throughout, every tappable area at
 * least 44pt. The spec lives in the "TuneMatch first run" design page.
 */
export const OB = {
  bg: '#221019',
  primary: '#f4258c',
  primaryPressed: '#d4177a',
  purple: '#8b5cf6',
  purpleTint: 'rgba(139,92,246,0.16)',
  purpleBorder: 'rgba(139,92,246,0.35)',
  purpleText: '#c4b5fd',
  teal: '#2dd4bf',
  text: '#FFFFFF',
  textDim: 'rgba(255,255,255,0.68)',
  textFaint: 'rgba(255,255,255,0.45)',
  surface: 'rgba(255,255,255,0.07)',
  surfaceRaised: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.12)',
  track: 'rgba(255,255,255,0.14)',
  error: '#FF6B6B',
  // Type scale: display (Welcome only), title, section, body, caption, overline.
  display: 34,
  title: 28,
  section: 17,
  body: 15,
  caption: 13,
  overline: 11,
  hit: 44,
  margin: 20,
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

/** Overline ("Step 1 of 2"), title and one-line explanation for a step. */
export const OnboardingIntro: React.FC<{ eyebrow?: string; title: string; subtitle?: string }> = ({
  eyebrow,
  title,
  subtitle,
}) => (
  <View style={styles.intro}>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
    <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
      {title}
    </Text>
    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
  </View>
);

type FooterProps = {
  ctaLabel: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** One quiet line above the button: what is picked, or what is needed. */
  summary?: string | null;
  bottomInset?: number;
  /** Welcome has nothing to separate from; the hairline is off there. */
  hairline?: boolean;
};

export const OnboardingFooter: React.FC<FooterProps> = ({
  ctaLabel,
  onPress,
  disabled,
  loading,
  summary,
  bottomInset = 0,
  hairline = true,
}) => (
  <View style={[styles.footer, hairline && styles.footerHairline, { paddingBottom: Math.max(bottomInset, Spacing.md) }]}>
    {summary ? (
      <Text style={styles.summary} numberOfLines={1}>
        {summary}
      </Text>
    ) : null}
    <PrimaryButton label={ctaLabel} onPress={onPress} disabled={disabled} loading={loading} />
  </View>
);

/** The one primary button: 56pt pink pill, label, arrow. Darkens on press. */
export const PrimaryButton: React.FC<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}> = ({ label, onPress, disabled, loading }) => {
  const inactive = !!disabled || !!loading;
  return (
    <Pressable
      style={({ pressed }) => [styles.cta, pressed && !inactive && styles.ctaPressed, inactive && styles.ctaInactive]}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator color={OB.text} />
      ) : (
        <>
          <Text style={styles.ctaLabel}>{label}</Text>
          <MaterialCommunityIcons name="arrow-right" size={20} color={OB.text} />
        </>
      )}
    </Pressable>
  );
};

/**
 * Filled chip. Selected is solid pink with a check, so the state never rests
 * on colour alone. `dimmed` is for "the section is full and this one is not
 * picked": still tappable (the screen explains the limit), visibly secondary.
 */
export const Chip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  dimmed?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Slot before the label, for an avatar. */
  leading?: React.ReactNode;
  /** Slot after the label, for a remove icon. */
  trailing?: React.ReactNode;
  /** 'grid': 48pt, 16pt label, stretches to its grid cell. Default: 40pt inline. */
  size?: 'inline' | 'grid';
  /** Dashed, quiet chip for "More" style affordances. */
  ghost?: boolean;
}> = ({ label, selected, onPress, dimmed, accessibilityLabel, accessibilityHint, leading, trailing, size = 'inline', ghost }) => (
  <Pressable
    style={({ pressed }) => [
      styles.chip,
      size === 'grid' && styles.chipGrid,
      ghost && styles.chipGhost,
      selected && styles.chipSelected,
      dimmed && !selected && styles.chipDimmed,
      pressed && styles.chipPressed,
    ]}
    onPress={onPress}
    hitSlop={4}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityHint={accessibilityHint}
  >
    {leading}
    <Text style={[styles.chipLabel, size === 'grid' && styles.chipLabelGrid, ghost && styles.chipLabelGhost]} numberOfLines={1}>
      {label}
    </Text>
    {trailing}
    {/* The check sits in the corner rather than inline, so a chip keeps its
        width when tapped and its neighbours do not reflow. */}
    {selected && !leading ? (
      <View style={styles.chipBadge} pointerEvents="none">
        <MaterialCommunityIcons name="check-bold" size={10} color={OB.primary} />
      </View>
    ) : null}
  </Pressable>
);

/** Section title on the left, "n of max" on the right, teal at the limit. */
export const SectionHeader: React.FC<{
  label: string;
  hint?: string;
  count?: number;
  max?: number;
}> = ({ label, hint, count, max }) => {
  const atMax = typeof count === 'number' && typeof max === 'number' && count >= max;
  return (
    <View style={styles.sectionRow}>
      <View style={styles.sectionLabelWrap}>
        <Text style={styles.sectionLabel}>{label}</Text>
        {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      </View>
      {typeof count === 'number' && typeof max === 'number' ? (
        <Text
          style={[styles.sectionCount, atMax && styles.sectionCountMax]}
          accessibilityLabel={`${count} of ${max} picked`}
        >
          {count} of {max}
        </Text>
      ) : null}
    </View>
  );
};

/**
 * "What we know about you": purple, so it reads as known rather than as a
 * choice being made now. With no taste it turns into a quiet way back to the
 * picker for people who skipped.
 */
export const TasteChip: React.FC<{
  summary: string | null;
  onPress: () => void;
}> = ({ summary, onPress }) => {
  const known = !!summary;
  return (
    <TouchableOpacity
      style={[styles.tasteChip, known ? styles.tasteChipKnown : styles.tasteChipEmpty]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={known ? `${summary}. Edit taste.` : 'No taste yet. Add your taste.'}
    >
      <View style={[styles.tasteDot, known ? styles.tasteDotKnown : styles.tasteDotEmpty]} />
      <Text style={styles.tasteChipText} numberOfLines={1}>
        {known ? summary : 'No taste yet'}
      </Text>
      <Text style={[styles.tasteChipAction, !known && styles.tasteChipActionEmpty]}>{known ? 'Edit' : 'Add'}</Text>
    </TouchableOpacity>
  );
};

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

  intro: { paddingHorizontal: OB.margin, paddingTop: Spacing.sm, gap: 6 },
  eyebrow: {
    color: OB.textFaint,
    fontSize: OB.overline,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  title: {
    color: OB.text,
    fontSize: OB.title,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  subtitle: { color: OB.textDim, fontSize: OB.body, lineHeight: 21 },

  footer: {
    paddingHorizontal: OB.margin,
    paddingTop: Spacing.sm + 2,
    backgroundColor: OB.bg,
    gap: Spacing.sm,
  },
  footerHairline: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OB.border,
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
  ctaPressed: { backgroundColor: OB.primaryPressed },
  ctaInactive: { opacity: 0.4 },
  ctaLabel: { color: OB.text, fontSize: 17, fontWeight: '700' },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: 20,
    backgroundColor: OB.surface,
    borderWidth: 1,
    borderColor: OB.border,
    maxWidth: '100%',
  },
  chipSelected: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
    shadowColor: OB.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  chipDimmed: { opacity: 0.45 },
  chipPressed: { transform: [{ scale: 0.96 }] },
  chipGrid: {
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: Spacing.sm,
    // Three equal columns with a 10pt gutter, whatever the label length.
    flexBasis: '31%',
    flexGrow: 1,
    maxWidth: '32%',
  },
  chipGhost: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.28)',
  },
  chipLabelGrid: { fontSize: 16 },
  chipLabelGhost: { color: OB.textDim },
  chipBadge: {
    position: 'absolute',
    top: -5,
    right: -4,
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: OB.text,
    borderWidth: 1.5,
    borderColor: OB.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: { color: OB.text, fontSize: OB.body, fontWeight: '600', flexShrink: 1 },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  sectionLabelWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 },
  sectionLabel: { color: OB.text, fontSize: OB.section, fontWeight: '700' },
  sectionHint: { color: OB.textFaint, fontSize: OB.caption, fontWeight: '500' },
  sectionCount: {
    color: OB.textFaint,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sectionCountMax: { color: OB.teal },

  tasteChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    paddingLeft: 10,
    paddingRight: 12,
    borderRadius: 17,
    borderWidth: 1,
    maxWidth: '100%',
  },
  tasteChipKnown: { backgroundColor: OB.purpleTint, borderColor: OB.purpleBorder },
  tasteChipEmpty: { backgroundColor: OB.surface, borderColor: OB.border },
  tasteDot: { width: 8, height: 8, borderRadius: 4 },
  tasteDotKnown: { backgroundColor: OB.teal },
  tasteDotEmpty: { backgroundColor: 'rgba(255,255,255,0.3)' },
  tasteChipText: { color: OB.text, fontSize: OB.caption, fontWeight: '600', flexShrink: 1 },
  tasteChipAction: { color: OB.purpleText, fontSize: OB.caption, fontWeight: '700', marginLeft: 2 },
  tasteChipActionEmpty: { color: OB.primary },
});
