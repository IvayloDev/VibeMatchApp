import * as React from 'react';
import { NavigationContainer, DefaultTheme, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, MD3DarkTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import WelcomeScreen from './app/welcome/WelcomeScreen';
import SignUpScreen from './app/welcome/SignUpScreen';
import SignInScreen from './app/welcome/SignInScreen';
import MainTabs from './app/tabs/MainTabs';
import PaymentScreen from './app/payment/PaymentScreen';
import { AuthProvider, useAuth } from './lib/AuthContext';
import LoadingScreen from './lib/LoadingScreen';
import { Colors } from './lib/designSystem';
import { initRevenueCat, identifyUser, logOutUser } from './lib/revenuecat';

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
  const { user, loading } = useAuth();
  const navigationRef = React.useRef(null);

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
        } else if (prevUserIdRef.current) {
          // User logged out - reset RevenueCat
          await logOutUser();
          prevUserIdRef.current = null;
        }
      } catch (error) {
        console.error('RevenueCat setup error:', error);
        // Don't block app if RevenueCat fails
      }
    };
    
    setupRevenueCat();
  }, [user?.id]);

  // Navigate to MainTabs if user is logged in when auth state loads
  React.useEffect(() => {
    if (!loading && user && navigationRef.current) {
      // User is logged in, navigate to MainTabs
      navigationRef.current.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  }, [loading, user]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer 
      ref={navigationRef}
      theme={NavigationTheme}
      onReady={() => {
        // When navigation is ready, check if user is logged in and navigate
        if (user && navigationRef.current) {
          navigationRef.current.reset({
            index: 0,
            routes: [{ name: 'MainTabs' }],
          });
        }
      }}
    >
      <Stack.Navigator 
        initialRouteName={user ? 'MainTabs' : 'Welcome'}
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
