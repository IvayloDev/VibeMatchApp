import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { Colors, BorderRadius, Shadows, Spacing } from '../designSystem';

interface FloatingCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  backgroundColor?: string;
  padding?: number;
}

export const FloatingCard: React.FC<FloatingCardProps> = ({
  children,
  style,
  backgroundColor = Colors.cardBackground,
  padding = Spacing.lg,
}) => {
  return (
    <View 
      style={[
        styles.card,
        { backgroundColor, padding },
        style
      ]}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    ...Shadows.card,
  },
});
