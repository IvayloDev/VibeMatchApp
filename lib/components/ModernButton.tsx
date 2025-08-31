import React from 'react';
import { TouchableOpacity, Text, ViewStyle, TextStyle, StyleSheet } from 'react-native';
import { Colors, Typography, BorderRadius, Shadows, Layout } from '../designSystem';

interface ModernButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
}

export const ModernButton: React.FC<ModernButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  style,
  textStyle,
  disabled = false,
}) => {
  const buttonStyle = variant === 'primary' ? styles.primaryButton : styles.secondaryButton;
  const buttonTextStyle = variant === 'primary' ? styles.primaryText : styles.secondaryText;
  
  return (
    <TouchableOpacity
      style={[
        styles.baseButton,
        buttonStyle,
        disabled && styles.disabled,
        style
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Text style={[buttonTextStyle, textStyle]}>
        {title}
      </Text>
    </TouchableOpacity>
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
