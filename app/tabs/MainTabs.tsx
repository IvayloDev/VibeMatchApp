import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DashboardScreen from '../tabs/home/DashboardScreen';
import RecommendationTypeScreen from '../tabs/home/RecommendationTypeScreen';
import AnalyzingScreen from '../tabs/home/AnalyzingScreen';
import ResultsScreen from '../tabs/home/ResultsScreen';
import HistoryScreen from '../tabs/history/HistoryScreen';
import ProfileScreen from '../tabs/profile/ProfileScreen';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../lib/designSystem';

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
        name="Results" 
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
          backgroundColor: Colors.cardBackground,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 8,
          height: 88,
        },
        tabBarActiveTintColor: Colors.accent.blue,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          marginTop: 4,
        },
        tabBarIcon: ({ color, size, focused }) => {
          let iconName;
          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'History') {
            iconName = focused ? 'history' : 'history';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'account' : 'account-outline';
          }
          return <MaterialCommunityIcons name={iconName} size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen 
        name="Home" 
        component={HomeStackNavigator}
        options={{
          tabBarLabel: 'Discover',
        }}
      />
      <Tab.Screen 
        name="History" 
        component={HistoryStackNavigator}
        options={{
          tabBarLabel: 'History',
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileStackNavigator}
        options={{
          tabBarLabel: 'Profile',
        }}
      />
    </Tab.Navigator>
  );
};

export default MainTabs; 