import React, { useEffect, useRef, useState } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { Colors, Typography } from '../designSystem';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  style?: any;
  textStyle?: any;
}

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  duration = 1000,
  style,
  textStyle,
}) => {
  const animatedValue = useRef(new Animated.Value(0)).current;
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: value,
      duration: duration,
      useNativeDriver: false,
    }).start();

    const listener = animatedValue.addListener(({ value: currentValue }) => {
      setDisplayValue(Math.round(currentValue));
    });

    return () => {
      animatedValue.removeListener(listener);
    };
  }, [value, duration, animatedValue]);

  return (
    <Text style={[styles.counter, style, textStyle]}>
      {displayValue}
    </Text>
  );
};

const styles = StyleSheet.create({
  counter: {
    ...Typography.heading3,
    color: Colors.accent.green,
    fontWeight: '700',
    fontSize: 20,
  },
});

