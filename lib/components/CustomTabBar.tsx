import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradientFallback } from './LinearGradientFallback';
import { BlurViewFallback } from './BlurViewFallback';
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../designSystem';
import { triggerHaptic } from '../utils/haptics';

interface TabBarProps {
  state: any;
  descriptors: any;
  navigation: any;
}

const CustomTabBar: React.FC<TabBarProps> = ({ state, descriptors, navigation }) => {
  const tabAnimations = useRef(
    state.routes.map(() => ({
      scale: new Animated.Value(1),
      glow: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    // Animate active tab
    state.routes.forEach((route: any, index: number) => {
      const isFocused = state.index === index;
      const anim = tabAnimations[index];
      
      if (isFocused) {
        Animated.parallel([
          Animated.spring(anim.scale, {
            toValue: 1.15,
            tension: 300,
            friction: 10,
            useNativeDriver: true,
          }),
          Animated.timing(anim.glow, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        Animated.parallel([
          Animated.spring(anim.scale, {
            toValue: 1,
            tension: 300,
            friction: 10,
            useNativeDriver: true,
          }),
          Animated.timing(anim.glow, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();
      }
    });
  }, [state.index]);

  const getIconName = (routeName: string, focused: boolean) => {
    switch (routeName) {
      case 'Home':
        return focused ? 'compass' : 'compass-outline';
      case 'History':
        return focused ? 'clock-time-four' : 'clock-outline';
      case 'Profile':
        return focused ? 'account-circle' : 'account-circle-outline';
      default:
        return 'circle';
    }
  };

  const getLabel = (routeName: string) => {
    switch (routeName) {
      case 'Home':
        return 'Discover';
      case 'History':
        return 'History';
      case 'Profile':
        return 'Profile';
      default:
        return routeName;
    }
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        <View style={styles.blurContainer}>
          <BlurViewFallback intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          <LinearGradientFallback
            colors={[Colors.cardBackground + 'F0', Colors.cardBackground + 'E0']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.tabBar}>
          {state.routes.map((route: any, index: number) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;
            const anim = tabAnimations[index];

            const onPress = () => {
              triggerHaptic('light');
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            const iconName = getIconName(route.name, isFocused);
            const label = getLabel(route.name);

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={options.tabBarTestID}
                onPress={onPress}
                onLongPress={onLongPress}
                style={styles.tab}
                activeOpacity={0.7}
              >
                <View style={styles.tabContent}>
                  {/* Active indicator dot */}
                  {isFocused && (
                    <Animated.View
                      style={[
                        styles.activeIndicator,
                        {
                          opacity: anim.glow,
                          transform: [{ scale: anim.glow }],
                        }
                      ]}
                    />
                  )}

                  {/* Icon with animation */}
                  <Animated.View
                    style={[
                      styles.iconContainer,
                      {
                        transform: [{ scale: anim.scale }],
                      }
                    ]}
                  >
                    {/* Glow effect for active tab */}
                    {isFocused && (
                      <Animated.View
                        style={[
                          styles.iconGlow,
                          {
                            opacity: anim.glow.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, 0.4],
                            }),
                            transform: [
                              {
                                scale: anim.glow.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0.8, 1.2],
                                }),
                              }
                            ],
                          }
                        ]}
                      >
                        <LinearGradientFallback
                          colors={[Colors.accent.blue + '40', Colors.accent.blue + '20', 'transparent']}
                          style={StyleSheet.absoluteFill}
                        />
                      </Animated.View>
                    )}
                    <MaterialCommunityIcons
                      name={iconName}
                      size={28}
                      color={isFocused ? Colors.accent.blue : Colors.textSecondary}
                    />
                  </Animated.View>

                  {/* Label */}
                  <Text
                    style={[
                      styles.label,
                      isFocused && styles.labelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  container: {
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  blurContainer: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    ...Shadows.prominent,
    borderTopWidth: 1,
    borderTopColor: Colors.border + '40',
  },
  tabBar: {
    flexDirection: 'row',
    height: 72,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.md,
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  activeIndicator: {
    position: 'absolute',
    top: -8,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.accent.blue,
  },
  iconContainer: {
    marginBottom: Spacing.xs,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 50,
    height: 50,
  },
  iconGlow: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    overflow: 'hidden',
  },
  label: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  labelActive: {
    color: Colors.accent.blue,
    fontWeight: '700',
    fontSize: 11,
  },
});

export default CustomTabBar;

