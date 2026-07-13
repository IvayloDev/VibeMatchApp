import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradientFallback as LinearGradient } from './LinearGradientFallback';
import { Spacing, BorderRadius, Shadows } from '../designSystem';
import { VIBES } from '../vibes';

type Props = {
  selected: string | null;
  onSelect: (vibeId: string) => void;
};

export const VibeGrid: React.FC<Props> = ({ selected, onSelect }) => {
  return (
    <View style={styles.grid}>
      {[VIBES.slice(0, 2), VIBES.slice(2, 4)].map((row, rowIdx) => (
        <View key={rowIdx} style={styles.row}>
          {row.map(vibe => {
            const isSelected = selected === vibe.id;
            return (
              <TouchableOpacity
                key={vibe.id}
                activeOpacity={0.9}
                onPress={() => onSelect(vibe.id)}
                style={styles.touchable}
              >
                <View
                  style={[
                    styles.card,
                    isSelected && styles.cardSelected,
                    isSelected && { shadowColor: vibe.gradient[0] },
                  ]}
                >
                  <LinearGradient
                    colors={vibe.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  {!isSelected && <View style={styles.overlay} pointerEvents="none" />}
                  <View style={styles.content}>
                    <MaterialCommunityIcons name={vibe.icon as any} size={32} color="#FFFFFF" />
                    <Text style={styles.title}>{vibe.name}</Text>
                    <Text style={styles.subtitle}>{vibe.subtitle}</Text>
                  </View>
                  {isSelected && (
                    <View style={styles.check}>
                      <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  touchable: {
    flex: 1,
  },
  card: {
    aspectRatio: 1.3,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    ...Shadows.card,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 18,
    elevation: 14,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  content: {
    flex: 1,
    padding: Spacing.md,
    justifyContent: 'flex-end',
    gap: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
    letterSpacing: 0.2,
  },
  check: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
