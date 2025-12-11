import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';

// Check if we're in Expo Go
let isExpoGo = false;
try {
  const Constants = require('expo-constants').default;
  isExpoGo = Constants?.appOwnership === 'expo' || Constants?.executionEnvironment === 'storeClient';
} catch {
  isExpoGo = false;
}

// Fallback LinearGradient for Expo Go
export const LinearGradientFallback: React.FC<{
  colors: string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [key: string]: any; // Allow other props
}> = ({ colors, start, end, style, children, ...props }) => {
  // In Expo Go, use a View with the first color as background
  if (isExpoGo) {
    // Use the first color as fallback, or average if multiple colors
    let backgroundColor = colors[0];
    if (colors.length > 1) {
      // Try to extract RGB values and average them (simplified)
      // For now, just use the first color
      backgroundColor = colors[0];
    }
    
    return (
      <View style={[style, { backgroundColor }]} {...props}>
        {children}
      </View>
    );
  }
  
  // In native builds, use the real LinearGradient
  try {
    const { LinearGradient } = require('expo-linear-gradient');
    return (
      <LinearGradient
        colors={colors}
        start={start}
        end={end}
        style={style}
        {...props}
      >
        {children}
      </LinearGradient>
    );
  } catch (error) {
    // Fallback if module not available
    const backgroundColor = colors[0] || '#000000';
    return (
      <View style={[style, { backgroundColor }]} {...props}>
        {children}
      </View>
    );
  }
};

