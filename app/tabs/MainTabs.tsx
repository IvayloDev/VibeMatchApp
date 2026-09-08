import React from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CommonActions, StackActions, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { LinearGradientFallback as LinearGradient } from '../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DashboardScreen from '../tabs/home/DashboardScreen';
import VibeSelectionScreen from '../tabs/home/VibeSelectionScreen';
import AnalyzingScreen from '../tabs/home/AnalyzingScreen';
import ResultsScreen from '../tabs/home/ResultsScreen';
import HistoryScreen from '../tabs/history/HistoryScreen';
import ProfileScreen from '../tabs/profile/ProfileScreen';
import { Colors, Spacing, BorderRadius, Shadows } from '../../lib/designSystem';
import { triggerHaptic } from '../../lib/utils/haptics';

const Tab = createBottomTabNavigator();

const TAB_BAR_STYLE = {
  position: 'absolute' as const,
  bottom: 0,
  left: 0,
  right: 0,
  backgroundColor: 'transparent',
  borderTopWidth: 0,
  elevation: 0,
  height: Platform.OS === 'ios' ? 90 : 80,
  paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  paddingTop: Spacing.xs,
  paddingHorizontal: Spacing.lg,
};

/**
 * Which nested screens run without the bar: the scan itself, and a Results
 * view reached from onboarding, whose only way forward is its own footer.
 */
function tabBarHiddenFor(route: any): boolean {
  const focused = getFocusedRouteNameFromRoute(route);
  if (focused === 'Analyzing') return true;
  if (focused === 'Results') {
    const nested = route?.state?.routes?.[route.state.index ?? 0];
    return nested?.params?.fromOnboarding === true;
  }
  return false;
}
const HomeStack = createNativeStackNavigator();
const HistoryStack = createNativeStackNavigator();
const ProfileStack = createNativeStackNavigator();

// Home Stack (Dashboard, VibeSelection, Analyzing, Results)
const HomeStackNavigator = () => {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Dashboard" component={DashboardScreen} />
      <HomeStack.Screen name="VibeSelection" component={VibeSelectionScreen} />
      <HomeStack.Screen 
        name="Analyzing" 
        component={AnalyzingScreen}
        options={{
          gestureEnabled: false, // Disable swipe back gesture
        }}
      />
      <HomeStack.Screen 
        name="Results" 
        component={ResultsScreen}
        options={{
          gestureEnabled: false, // Disable swipe back gesture
        }}
      />
    </HomeStack.Navigator>
  );
};

// History Stack (History only)
const HistoryStackNavigator = () => {
  return (
    <HistoryStack.Navigator screenOptions={{ headerShown: false }}>
      <HistoryStack.Screen name="History" component={HistoryScreen} />
      <HistoryStack.Screen 
        name="HistoryResults" 
        component={ResultsScreen}
        options={{
          gestureEnabled: true, // Enable swipe back gesture
        }}
      />
    </HistoryStack.Navigator>
  );
};

// Profile Stack (Profile only)
const ProfileStackNavigator = () => {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="Profile" component={ProfileScreen} />
    </ProfileStack.Navigator>
  );
};

const MainTabs = () => {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
          headerShown: false,
          // The navigator decides when the bar is hidden, from the focused
          // nested route. Screens used to call parent.setOptions({tabBarStyle})
          // to hide it and then "restore" it, and every restore stripped the
          // bar: React Navigation spreads per-screen options over these, so
          // both { display: 'flex' } and undefined REPLACE this style object
          // rather than falling back to it. The result was a stock, unpadded,
          // opaque bar on the Home tab after every scan - until the Discover
          // tabPress reset recreated the route and snapped it back, which is
          // the "bar changes when I tap Discover" symptom. With the decision
          // here there is no restore step, so nothing can leak.
          tabBarStyle: tabBarHiddenFor(route) ? { display: 'none' } : TAB_BAR_STYLE,
          tabBarBackground: () => (
            <View style={{ 
              flex: 1, 
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              overflow: 'hidden', 
              marginHorizontal: 0,
              backgroundColor: '#1C1C1E',
            }}>
              <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 1,
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
              }} />
            </View>
          ),
          tabBarActiveTintColor: '#FF3B30', // Red color for active tab
          tabBarInactiveTintColor: 'rgba(148, 163, 184, 0.6)', // Grey for inactive tabs
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '700',
            marginTop: 4,
            letterSpacing: 1,
            textTransform: 'uppercase',
          },
          tabBarIcon: ({ color, focused }) => {
            let iconName: string;
            let iconSize = 28;

            // Icons matched to the results-redesign reference: concentric rings
            // for Discover, stacked list lines for Vault, pie for Profile.
            if (route.name === 'Home') {
              iconName = 'circle-double';
            } else if (route.name === 'History') {
              iconName = 'view-list-outline';
            } else if (route.name === 'Profile') {
              iconName = 'circle-slice-2';
            } else {
              iconName = 'circle';
            }

            return (
              <View
                style={{
                  transform: [{ scale: focused ? 1.1 : 1 }],
                  ...(focused && {
                    shadowColor: '#FF3B30',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.8,
                    shadowRadius: 12,
                  }),
                }}
              >
                <MaterialCommunityIcons 
                  name={iconName as any} 
                  size={iconSize} 
                  color={color}
                />
              </View>
            );
          },
        })
      }
    >
      <Tab.Screen 
        name="Home" 
        component={HomeStackNavigator}
        options={{
          tabBarLabel: 'Discover',
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            triggerHaptic('light');
            // Always navigate to Dashboard when tab is pressed
            const state = navigation.getState();
            const homeTab = state.routes.find((r: any) => r.name === 'Home');
            
            // Check if we're not already on Dashboard
            const needsReset = !homeTab?.state || 
              homeTab.state.routes[homeTab.state.index]?.name !== 'Dashboard';
            
            if (needsReset) {
              // Prevent default tab navigation
              e.preventDefault();
              
              // Reset Home stack to Dashboard
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [
                    {
                      name: 'Home',
                      state: {
                        routes: [{ name: 'Dashboard' }],
                        index: 0,
                      },
                    },
                  ],
                })
              );
            }
          },
        })}
      />
      <Tab.Screen 
        name="History" 
        component={HistoryStackNavigator}
        options={{
          tabBarLabel: 'Vault',
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            triggerHaptic('light');
            // The Vault always opens on the list. Open a match, switch tabs,
            // come back a day later and the stack would otherwise still be
            // sitting on that one result, which reads as the app being stuck.
            const historyTab = navigation
              .getState()
              .routes.find((r: any) => r.name === 'History');
            const stack = historyTab?.state as any;
            if (stack?.key && (stack.index ?? 0) > 0) {
              navigation.dispatch({ ...StackActions.popToTop(), target: stack.key });
            }
          },
        })}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileStackNavigator}
        options={{
          tabBarLabel: 'Profile',
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            triggerHaptic('light');
          },
        })}
      />
    </Tab.Navigator>
  );
};

export default MainTabs; 