import * as React from 'react';
import { AppState } from 'react-native';
import { bindAuthRefreshToAppState } from './lib/supabase';
import { setProFromClient } from './lib/creditState';
import { bootstrapSession } from './lib/identity';
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
import { initRevenueCat, identifyUser, logOutUser, reconcileProAfterLogin, subscribeToProStatus } from './lib/revenuecat';
import { identifyUser as posthogIdentify, resetUser as posthogReset, trackScreen } from './lib/posthog';
import { rescheduleEngagementReminders } from './lib/notifications';
import { primeFeatureFlags, isSpotifyConnectEnabled } from './lib/featureFlags';
import TastePickerScreen from './app/onboarding/TastePickerScreen';
import DebugResetButton from './lib/components/DebugResetButton';

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
  const { user, loading, spotifyConnected, spotifyChecking, onboardingComplete, guestOnboardingComplete, onboardingChecking } = useAuth();
  const navigationRef = React.useRef(null);
  const routeNameRef = React.useRef(null);

  // Ref so routing effect reads latest value without re-triggering when it changes
  const onboardingCompleteRef = React.useRef(onboardingComplete);
  React.useEffect(() => { onboardingCompleteRef.current = onboardingComplete; }, [onboardingComplete]);

  const guestOnboardingCompleteRef = React.useRef(guestOnboardingComplete);
  React.useEffect(() => { guestOnboardingCompleteRef.current = guestOnboardingComplete; }, [guestOnboardingComplete]);

  const getTarget = React.useCallback(() => {
    // A guest who already finished onboarding on this device goes straight to
    // the app. Returning them to Welcome sent them through the whole flow again
    // on every cold start - and since onboarding only exits by completing a
    // scan, a guest out of credits could never get past it.
    // An anonymous identity is a GUEST, not a signed-in user. Asking `!user`
    // stopped meaning "guest" the moment every install got a Supabase uid, and
    // routing an anonymous user down the registered path sends someone
    // part-way through onboarding to ConnectSpotify or MainTabs underneath
    // whatever screen they were on.
    if (!user || user.is_anonymous) {
      return guestOnboardingCompleteRef.current ? 'MainTabs' : 'Welcome';
    }
    // The Spotify prompt is behind a remote flag (off for the public: the
    // Spotify app is in Development mode, so listening data never loads for
    // anyone but allowlisted testers). Registered users are only routed to it
    // when the flag is on for them.
    if (!spotifyConnected && isSpotifyConnectEnabled()) return 'ConnectSpotify';
    if (!onboardingCompleteRef.current) return 'Onboarding';
    return 'MainTabs';
  }, [user, spotifyConnected]);

  // Fetch remote kill switches once per cold start. Unknown flags count as
  // off, so nothing waits on this.
  React.useEffect(() => {
    primeFeatureFlags();
  }, []);

  // Track previous user ID to detect logout
  const prevUserIdRef = React.useRef(null);

  // Initialize RevenueCat and identify user when auth state changes
  React.useEffect(() => {
    // Delay initialization slightly to ensure native module is ready
    const setupRevenueCat = async () => {
      try {
        // Configure with NO app user id, so RevenueCat starts on its own
        // anonymous id and is told who this is later, by identifyUser inside
        // the identity broker. That transition is what moves a guest's
        // existing purchases onto the Supabase uid; configuring straight into
        // a uid skips the transition and orphans anything bought before.
        //
        // The one-second sleep that used to be here was a guess at when the
        // native module is ready. initRevenueCat waits for it properly, and
        // the sleep only delayed the paywall for everyone.
        await initRevenueCat();

        // Registered users only. An anonymous identity is handled by the
        // identity broker's afterMint, which already tells RevenueCat who this
        // is; doing it twice would race two logIn calls for the same uid, and
        // reconcileProAfterLogin is about carrying a subscription onto a REAL
        // account, which an anonymous id is not.
        if (user?.id && !user.is_anonymous) {
          // Carry a guest's subscription across to the new account. Without this
          // a user who subscribes as a guest and then signs up loses Pro while
          // still being charged.
          await reconcileProAfterLogin(user.id);
          prevUserIdRef.current = user.id;
          posthogIdentify(user.id, { email: user.email });
        } else if (!user?.id && prevUserIdRef.current) {
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

  // Keep the auth token alive across foreground/background. Without this a
  // resumed app carries an expired token and 401s until something forces a
  // refresh, which now means a guest whose own account looks unreachable.
  React.useEffect(() => bindAuthRefreshToAppState(), []);

  // Pro status, the instant RevenueCat knows it, from anywhere in the app.
  //
  // The purchase screens ask the server to re-read RevenueCat when a purchase
  // finishes, but that is one path and it is asynchronous. This listener fires
  // on every customer-info change - a purchase, a restore, a renewal, a
  // subscription bought on another device - so the UI flips immediately and
  // the server is asked to catch up in the same breath. Without it there is a
  // window where somebody who has just paid is still being sold Pro.
  React.useEffect(() => subscribeToProStatus((isPro) => {
    setProFromClient(isPro);
    if (isPro) void bootstrapSession();
  }), []);

  // Navigate based on auth + Spotify connection state.
  // onboardingComplete intentionally excluded from deps — changes to it are handled
  // by OnboardingScreen itself to avoid resetting nav mid-flow.
  React.useEffect(() => {
    if (loading || spotifyChecking || onboardingChecking || !navigationRef.current) return;
    // Guests, anonymous identity or not, are driven from WelcomeScreen. This
    // effect exists to route a REGISTERED user after sign-in; letting it fire
    // for an anonymous mint resets navigation mid-onboarding, which is exactly
    // what happens when a lazy mint lands while somebody is picking a photo.
    if (!user || user.is_anonymous) return;
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

        {/* Optional Spotify connect prompt - skippable, matching works without it */}
        <Stack.Screen
          name="ConnectSpotify"
          component={ConnectSpotifyScreen}
          options={{ gestureEnabled: false }}
        />

        {/* Taste picker: artists and genres chosen in-app. Replaces the Spotify
            prompt for the public; also reachable from Profile to edit taste. */}
        <Stack.Screen
          name="TastePicker"
          component={TastePickerScreen}
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
          {/* Debug-only, renders nothing in a production build. Outside the
              navigator so it floats over every screen. */}
          <DebugResetButton />
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
