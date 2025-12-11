import React from 'react';
import { View, StyleSheet } from 'react-native';
import SkeletonPlaceholder from 'react-native-skeleton-placeholder';
import { Colors, BorderRadius, Spacing } from '../designSystem';

type SkeletonLoaderProps = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
};

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  width = '100%',
  height = 20,
  borderRadius = BorderRadius.sm,
  style,
}) => {
  return (
    <SkeletonPlaceholder
      backgroundColor={Colors.cardBackground}
      highlightColor={Colors.cardBackgroundSecondary}
      speed={1200}
    >
      <View style={[styles.skeleton, { width, height, borderRadius }, style]} />
    </SkeletonPlaceholder>
  );
};

export const SkeletonCard: React.FC = () => {
  return (
    <SkeletonPlaceholder
      backgroundColor={Colors.cardBackground}
      highlightColor={Colors.cardBackgroundSecondary}
      speed={1200}
    >
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.avatar} />
          <View style={styles.headerText}>
            <View style={styles.title} />
            <View style={styles.subtitle} />
          </View>
        </View>
        <View style={styles.content} />
        <View style={styles.footer} />
      </View>
    </SkeletonPlaceholder>
  );
};

export const SkeletonCreditDisplay: React.FC = () => {
  return (
    <SkeletonPlaceholder
      backgroundColor={Colors.cardBackground}
      highlightColor={Colors.cardBackgroundSecondary}
      speed={1200}
    >
      <View style={styles.creditContainer}>
        <View style={styles.creditValue} />
        <View style={styles.creditLabel} />
      </View>
    </SkeletonPlaceholder>
  );
};

const styles = StyleSheet.create({
  skeleton: {
    width: '100%',
  },
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: BorderRadius.round,
    marginRight: Spacing.md,
  },
  headerText: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    width: '60%',
    height: 16,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    width: '40%',
    height: 12,
    borderRadius: BorderRadius.sm,
  },
  content: {
    width: '100%',
    height: 100,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  footer: {
    width: '30%',
    height: 14,
    borderRadius: BorderRadius.sm,
  },
  creditContainer: {
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    minWidth: 80,
  },
  creditValue: {
    width: 40,
    height: 20,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  creditLabel: {
    width: 50,
    height: 12,
    borderRadius: BorderRadius.sm,
  },
});

