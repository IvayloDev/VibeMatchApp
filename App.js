import * as React from 'react';
import { AppState } from 'react-native';
import { NavigationContainer, DefaultTheme, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, MD3DarkTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import WelcomeScreen from './app/welcome/WelcomeScreen';
import SignUpScreen from './app/welcome/SignUpScreen';
import SignInScreen from './app/welcome/SignInScreen';
import ConnectSpotifyScreen from './app/welcome/ConnectSpotifyScreen';
import OnboardingScreen from './app/onboarding/OnboardingScreen';
import AnalyzingScreen from './app/tabs/home/AnalyzingScreen';
import MainTabs from './app/tabs/MainTabs';
import PaymentScreen from './app/payment/PaymentScreen';
import { AuthProvider, useAuth } from './lib/AuthContext';
import LoadingScreen from './lib/LoadingScreen';
import { Colors } from './lib/designSystem';
import { initRevenueCat, identifyUser, logOutUser } from './lib/revenuecat';
import { identifyUser as posthogIdentify, resetUser as posthogReset, trackScreen } from './lib/posthog';
import { rescheduleEngagementReminders } from './lib/notifications';

const Stack = createNativeStackNavigator();

// Custom theme for React Navigation
const NavigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.background,
    card: Colors.cardBackground,
    text: Colors.textPrimary,
    border: Colors.border,
    notification: Colors.accent.blue,
  },
};

// Custom theme for React Native Paper
const PaperTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: Colors.accent.blue,
    background: Colors.background,
    surface: Colors.cardBackground,
    surfaceVariant: Colors.cardBackgroundSecondary,
    onSurface: Colors.textPrimary,
    onSurfaceVariant: Colors.textSecondary,
  },
};

function AppContent() {
  const { user, loading, spotifyConnected, spotifyChecking, onboardingComplete, onboardingChecking } = useAuth();
  const navigationRef = React.useRef(null);
  const routeNameRef = React.useRef(null);

  // Ref so routing effect reads latest value without re-triggering when it changes
  const onboardingCompleteRef = React.useRef(onboardingComplete);
  React.useEffect(() => { onboardingCompleteRef.current = onboardingComplete; }, [onboardingComplete]);

  const getTarget = React.useCallback(() => {
    if (!user) return 'Welcome';
    if (!spotifyConnected) return 'ConnectSpotify';
    if (!onboardingCompleteRef.current) return 'Onboarding';
    return 'MainTabs';
  }, [user, spotifyConnected]);

  // Track previous user ID to detect logout
  const prevUserIdRef = React.useRef(null);

  // Initialize RevenueCat and identify user when auth state changes
  React.useEffect(() => {
    // Delay initialization slightly to ensure native module is ready
    const setupRevenueCat = async () => {
      try {
        // Longer delay to ensure native modules are fully loaded
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Initialize with user ID if available
        await initRevenueCat(user?.id);
        
        if (user?.id) {
          prevUserIdRef.current = user.id;
          posthogIdentify(user.id, { email: user.email });
        } else if (prevUserIdRef.current) {
          // User logged out - reset RevenueCat and PostHog
          await logOutUser();
          posthogReset();
          prevUserIdRef.current = null;
        }
      } catch (error) {
        console.error('RevenueCat setup error:', error);
        // Don't block app if RevenueCat fails
      }
    };
    
    setupRevenueCat();
  }, [user?.id]);

  // Re-arm the gentle re-engagement notification ladder on every app open /
  // foreground. This acts as an inactivity timer: any time the user returns,
  // the +3/+10/+17/+24-day reminders reset, so active users are never nagged.
  // No-op until notification permission is granted (asked after 1st match).
  React.useEffect(() => {
    rescheduleEngagementReminders();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') rescheduleEngagementReminders();
    });
    return () => sub.remove();
  }, []);

  // Navigate based on auth + Spotify connection state.
  // onboardingComplete intentionally excluded from deps — changes to it are handled
  // by OnboardingScreen itself to avoid resetting nav mid-flow.
  React.useEffect(() => {
    if (loading || spotifyChecking || onboardingChecking || !navigationRef.current) return;
    if (!user) return; // guest flow is driven from WelcomeScreen
    const target = getTarget();
    navigationRef.current.reset({
      index: 0,
      routes: [{ name: target }],
    });
  }, [loading, spotifyChecking, onboardingChecking, user, spotifyConnected, getTarget]);

  if (loading || spotifyChecking || onboardingChecking) {
    return <LoadingScreen />;
  }

  // By the time we get here, onboardingCompleteRef is in sync with onboardingComplete
  const initialRoute = getTarget();

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={NavigationTheme}
      onReady={() => {
        if (user && navigationRef.current) {
          navigationRef.current.reset({
            index: 0,
            routes: [{ name: getTarget() }],
          });
        }
        const route = navigationRef.current?.getCurrentRoute();
        if (route) {
          routeNameRef.current = route.name;
          trackScreen(route.name);
        }
      }}
      onStateChange={() => {
        const route = navigationRef.current?.getCurrentRoute();
        if (route && route.name !== routeNameRef.current) {
          routeNameRef.current = route.name;
          trackScreen(route.name);
        }
      }}
    >
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ 
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: 300,
          gestureEnabled: true,
          gestureDirection: 'horizontal',
        }}
      >
        {/* Welcome and auth screens - shown first */}
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="SignUp" component={SignUpScreen} />
        <Stack.Screen name="SignIn" component={SignInScreen} />

        {/* Required Spotify connect gate */}
        <Stack.Screen
          name="ConnectSpotify"
          component={ConnectSpotifyScreen}
          options={{ gestureEnabled: false }}
        />

        {/* First-time onboarding (Spotify Wrapped-style) */}
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ gestureEnabled: false }}
        />

        {/* Analyzing screen used during onboarding (before MainTabs is mounted) */}
        <Stack.Screen
          name="OnboardingAnalyzing"
          component={AnalyzingScreen}
          options={{ gestureEnabled: false }}
        />

        {/* Main app - accessible without authentication (Apple guideline 5.1.1) */}
        <Stack.Screen 
          name="MainTabs" 
          component={MainTabs}
          options={{
            gestureEnabled: false,
            headerShown: false,
          }}
        />
        
        {/* Payment screen accessible regardless of auth state (Apple guideline 5.1.1) */}
        <Stack.Screen name="Payment" component={PaymentScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  // Disable React Native inspector overlays on mount
  React.useEffect(() => {
    if (typeof global !== 'undefined') {
      // Ensure inspector is disabled
      if (global.__RCTProfileIsProfiling !== undefined) {
        global.__RCTProfileIsProfiling = false;
      }
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={Colors.background} />
      <PaperProvider theme={PaperTheme}>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
