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

// Fallback BlurView for Expo Go
export const BlurViewFallback: React.FC<{
  intensity?: number;
  tint?: 'light' | 'dark' | 'default';
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}> = ({ intensity = 80, tint = 'dark', style, children }) => {
  // In Expo Go, use a semi-transparent View instead
  if (isExpoGo) {
    const opacity = Math.min(intensity / 100, 0.9);
    const backgroundColor = tint === 'dark' 
      ? `rgba(0, 0, 0, ${opacity * 0.7})`
      : tint === 'light'
      ? `rgba(255, 255, 255, ${opacity * 0.7})`
      : `rgba(128, 128, 128, ${opacity * 0.5})`;
    
    return (
      <View style={[style, { backgroundColor }]}>
        {children}
      </View>
    );
  }
  
  // In native builds, use the real BlurView
  try {
    const { BlurView } = require('expo-blur');
    return (
      <BlurView intensity={intensity} tint={tint} style={style}>
        {children}
      </BlurView>
    );
  } catch (error) {
    // Fallback if module not available
    const opacity = Math.min(intensity / 100, 0.9);
    const backgroundColor = tint === 'dark' 
      ? `rgba(0, 0, 0, ${opacity * 0.7})`
      : tint === 'light'
      ? `rgba(255, 255, 255, ${opacity * 0.7})`
      : `rgba(128, 128, 128, ${opacity * 0.5})`;
    
    return (
      <View style={[style, { backgroundColor }]}>
        {children}
      </View>
    );
  }
};

