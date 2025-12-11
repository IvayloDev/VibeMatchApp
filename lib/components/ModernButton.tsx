import React, { useRef } from 'react';
import { TouchableOpacity, Text, ViewStyle, TextStyle, StyleSheet, Animated } from 'react-native';
import { Colors, Typography, BorderRadius, Shadows, Layout } from '../designSystem';
import { triggerHaptic } from '../utils/haptics';

interface ModernButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
  hapticType?: 'light' | 'medium' | 'heavy' | 'success';
}

export const ModernButton: React.FC<ModernButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  style,
  textStyle,
  disabled = false,
  hapticType = 'medium',
}) => {
  const buttonStyle = variant === 'primary' ? styles.primaryButton : styles.secondaryButton;
  const buttonTextStyle = variant === 'primary' ? styles.primaryText : styles.secondaryText;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (!disabled) {
      triggerHaptic(hapticType);
      Animated.spring(scaleAnim, {
        toValue: 0.95,
        useNativeDriver: true,
        friction: 3,
        tension: 300,
      }).start();
    }
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 3,
      tension: 300,
    }).start();
  };

  const handlePress = () => {
    if (!disabled) {
      onPress();
    }
  };
  
  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.baseButton,
          buttonStyle,
          disabled && styles.disabled,
          style
        ]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        activeOpacity={0.9}
      >
        <Text style={[buttonTextStyle, textStyle]}>
          {title}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  baseButton: {
    height: Layout.buttonHeight,
    borderRadius: BorderRadius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    ...Shadows.card,
  },
  primaryButton: {
    backgroundColor: Colors.buttonPrimary,
  },
  secondaryButton: {
    backgroundColor: Colors.buttonSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  primaryText: {
    ...Typography.button,
    color: Colors.buttonPrimaryText,
  },
  secondaryText: {
    ...Typography.button,
    color: Colors.buttonSecondaryText,
  },
  disabled: {
    opacity: 0.5,
  },
});
