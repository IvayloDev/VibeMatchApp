import React from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CommonActions } from '@react-navigation/native';
import { LinearGradientFallback as LinearGradient } from '../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DashboardScreen from '../tabs/home/DashboardScreen';
import RecommendationTypeScreen from '../tabs/home/RecommendationTypeScreen';
import AnalyzingScreen from '../tabs/home/AnalyzingScreen';
import ResultsScreen from '../tabs/home/ResultsScreen';
import HistoryScreen from '../tabs/history/HistoryScreen';
import ProfileScreen from '../tabs/profile/ProfileScreen';
import { Colors, Spacing, BorderRadius, Shadows } from '../../lib/designSystem';
import { triggerHaptic } from '../../lib/utils/haptics';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const HistoryStack = createNativeStackNavigator();
const ProfileStack = createNativeStackNavigator();

// Home Stack (Dashboard, RecommendationType, Analyzing, Results)
const HomeStackNavigator = () => {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Dashboard" component={DashboardScreen} />
      <HomeStack.Screen name="RecommendationType" component={RecommendationTypeScreen} />
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
          tabBarStyle: {
            position: 'absolute',
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
          },
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

            if (route.name === 'Home') {
              iconName = 'compass';
            } else if (route.name === 'History') {
              iconName = 'clock-outline';
            } else if (route.name === 'Profile') {
              iconName = 'account-circle-outline';
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
          tabPress: (e) => {
            triggerHaptic('light');
            // Always navigate to History list screen when tab is pressed
            // Use nested navigation to go to the History screen in the History stack
            const state = navigation.getState();
            const historyTab = state.routes.find((r: any) => r.name === 'History');
            
            if (historyTab?.state) {
              const currentRoute = historyTab.state.routes[historyTab.state.index];
              if (currentRoute.name !== 'History') {
                // Navigate to History screen in the History stack
                navigation.navigate('History', { screen: 'History' });
              }
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