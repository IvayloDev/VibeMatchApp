import * as React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
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

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer theme={NavigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          // User is authenticated - show main app
          <>
            <Stack.Screen 
              name="MainTabs" 
              component={MainTabs}
              options={{
                gestureEnabled: false,
                headerShown: false,
              }}
            />
            <Stack.Screen name="Payment" component={PaymentScreen} />
          </>
        ) : (
          // User is not authenticated - show auth screens
          <>
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="SignUp" component={SignUpScreen} />
            <Stack.Screen name="SignIn" component={SignInScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
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
