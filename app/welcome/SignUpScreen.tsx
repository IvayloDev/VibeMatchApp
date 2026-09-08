import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase, signInWithApple, signInWithGoogle } from '../../lib/supabase';
import { Colors, Typography, Spacing, Layout, BorderRadius } from '../../lib/designSystem';
import { getSpotifyConnectionStatus } from '../../lib/spotify';
import { trackEvent } from '../../lib/posthog';

const { width, height } = Dimensions.get('window');

// Define the navigation stack param list
type RootStackParamList = {
  Welcome: undefined;
  SignUp: undefined;
  SignIn: undefined;
  ConnectSpotify: undefined;
  MainTabs: undefined;
};

const SignUpScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const routeAfterAuth = async () => {
    const status = await getSpotifyConnectionStatus();
    navigation.reset({
      index: 0,
      routes: [{ name: status.connected ? 'MainTabs' : 'ConnectSpotify' }],
    });
  };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const handleSignUp = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (!emailRegex.test(cleanEmail)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }
    setLoading(true);
    trackEvent('registration_started', { method: 'email' });
    // If this device already has an anonymous identity, UPGRADE it rather than
    // creating a second account.
    //
    // signUp() mints a brand new auth.users row and replaces the session. The
    // anonymous user - holding the balance, the purchases and the Vault - is
    // simply abandoned, and nothing carries over: the old local merge was
    // deleted when credits moved server-side, and claim_device_starter will
    // not re-grant a starter because the DEVICE already claimed one. So
    // registering used to cost a guest everything they had, including a pack
    // they paid for.
    //
    // updateUser on an anonymous session attaches the email and password to
    // the SAME uid, so the balance, purchases and history stay exactly where
    // they are and there is nothing to merge.
    const { data: { session: existing } } = await supabase.auth.getSession();
    const upgradingAnonymous = !!existing?.user?.is_anonymous;

    const { data, error } = upgradingAnonymous
      ? await supabase.auth.updateUser({ email: cleanEmail, password })
          .then((r) => ({ data: r.data?.user ? { user: r.data.user, session: existing } : null, error: r.error }))
      : await supabase.auth.signUp({ email: cleanEmail, password });
    setLoading(false);
    if (error) {
      trackEvent('registration_failed', { method: 'email', error: error.message });
      Alert.alert('Sign Up Error', error.message);
    } else if (data?.user) {
      // With email confirmation on, the user row exists but there's no session
      // yet - that's a different outcome from a fully completed signup.
      trackEvent('registration_completed', {
        method: 'email',
        needs_confirmation: !data.session,
        // Whether this kept the guest's existing identity or made a new one.
        // If this is ever false for someone who had been using the app, they
        // lost a balance and a Vault, and that is worth being able to count.
        upgraded_anonymous: upgradingAnonymous,
      });
      await routeAfterAuth();
    }
  };

  const handleGoogleSignUp = async () => {
    setSocialLoading('google');
    trackEvent('registration_started', { method: 'google' });
    try {
      const result = await signInWithGoogle();
      if (result.success) {
        trackEvent('registration_completed', { method: 'google' });
        await routeAfterAuth();
      } else if (result.error) {
        trackEvent('registration_failed', { method: 'google', error: result.error });
        Alert.alert('Google Sign-Up Error', result.error);
      } else {
        // No success, no error - the user backed out of the provider sheet.
        trackEvent('registration_cancelled', { method: 'google' });
      }
    } catch (error) {
      trackEvent('registration_failed', { method: 'google', error: (error as Error)?.message ?? 'exception' });
      console.error('Google sign-up error:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
    setSocialLoading(null);
  };

  const handleAppleSignUp = async () => {
    setSocialLoading('apple');
    trackEvent('registration_started', { method: 'apple' });
    try {
      const result = await signInWithApple();
      if (result.success) {
        trackEvent('registration_completed', { method: 'apple' });
        await routeAfterAuth();
      } else if (result.error) {
        trackEvent('registration_failed', { method: 'apple', error: result.error });
        Alert.alert('Apple Sign-Up Error', result.error);
      } else {
        trackEvent('registration_cancelled', { method: 'apple' });
      }
    } catch (error) {
      trackEvent('registration_failed', { method: 'apple', error: (error as Error)?.message ?? 'exception' });
      console.error('Apple sign-up error:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
    setSocialLoading(null);
  };

  // Reached from Welcome (back = Welcome) and from inside the app (back = where
  // they came from). If neither is possible, land on the app rather than trap.
  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' as never }] });
    }
  };

  return (
    <View style={styles.container}>
      {/* Escape hatch. These screens are reached from inside the app (Profile,
          the paywall) as well as from Welcome, and with the stack header hidden
          there was no way back at all - a dead end. goBack when there is
          somewhere to go, otherwise drop into the app. */}
      <SafeAreaView style={styles.authBackWrap} edges={['top']} pointerEvents="box-none">
        <TouchableOpacity
          onPress={handleDismiss}
          style={styles.authBackButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </SafeAreaView>
      {/* Background Blur Effects */}
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />
      
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <KeyboardAvoidingView 
          style={styles.keyboardContainer} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView 
            contentContainerStyle={styles.scrollContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header Section */}
            <View style={styles.headerContainer}>
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>Join the musical revolution</Text>
            </View>
            
            {/* Form Section */}
            <View style={styles.formContainer}>
              {/* Email Input */}
              <View style={styles.inputWrapper}>
                <MaterialCommunityIcons 
                  name="email-outline" 
                  size={20} 
                  color="#FF3B30" 
                  style={styles.inputIcon}
                />
                <TextInput
                  placeholder="Email Address"
                  placeholderTextColor="rgba(255, 255, 255, 0.5)"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  style={styles.input}
                  selectionColor="#FF3B30"
                />
              </View>

              {/* Password Input */}
              <View style={styles.inputWrapper}>
                <MaterialCommunityIcons 
                  name="lock-outline" 
                  size={20} 
                  color="#FF3B30" 
                  style={styles.inputIcon}
                />
                <TextInput
                  placeholder="Password"
                  placeholderTextColor="rgba(255, 255, 255, 0.5)"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="password"
                  style={styles.input}
                  selectionColor="#FF3B30"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.passwordToggle}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons 
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'} 
                    size={20} 
                    color="rgba(255, 255, 255, 0.5)" 
                  />
                </TouchableOpacity>
              </View>

              {/* Create Account Button - Solid Red */}
              <TouchableOpacity
                style={[styles.signUpButton, !canSubmit && { opacity: 0.5 }]}
                onPress={handleSignUp}
                disabled={!canSubmit}
                activeOpacity={0.9}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.signUpButtonText}>Create Account</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Divider */}
            <View style={styles.dividerContainer}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.divider} />
            </View>

            {/* Social Login Buttons */}
            <View style={styles.socialButtonsContainer}>
              {/* Google Button */}
              <TouchableOpacity 
                style={[styles.socialButton, styles.googleButton]} 
                onPress={handleGoogleSignUp}
                disabled={socialLoading !== null}
                activeOpacity={0.9}
              >
                {socialLoading === 'google' ? (
                  <ActivityIndicator size="small" color="#1F1F1F" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="google" size={20} color="#FF3B30" />
                    <Text style={styles.googleButtonText}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>
              
              {/* Apple Button */}
              {Platform.OS === 'ios' && (
                <TouchableOpacity 
                  style={[styles.socialButton, styles.appleButton]} 
                  onPress={handleAppleSignUp}
                  disabled={socialLoading !== null}
                  activeOpacity={0.9}
                >
                  {socialLoading === 'apple' ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="apple" size={20} color="#FF3B30" />
                      <Text style={styles.appleButtonText}>Continue with Apple</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* Footer Links */}
            <View style={styles.footerContainer}>
              <TouchableOpacity 
                onPress={() => {
                  navigation.navigate('SignIn');
                }} 
                style={styles.signInLink}
                activeOpacity={0.7}
              >
                <Text style={styles.signInText}>
                  Already have an account?{' '}
                  <Text style={styles.signInLinkText}>Sign In</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  authBackWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 50,
  },
  authBackButton: {
    marginTop: Spacing.sm,
    marginLeft: Spacing.md,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: { 
    flex: 1,
    backgroundColor: '#221019', // Matching app background
  },
  safeArea: {
    flex: 1,
  },
  backgroundBlur1: {
    position: 'absolute',
    top: -height * 0.1,
    left: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: '#f4258c20',
    borderRadius: 9999,
    opacity: 0.3,
  },
  backgroundBlur2: {
    position: 'absolute',
    bottom: -height * 0.1,
    right: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: '#8b5cf620',
    borderRadius: 9999,
    opacity: 0.3,
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContainer: { 
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.xxxl,
    paddingBottom: Spacing.xl,
  },
  headerContainer: {
    marginBottom: Spacing.xxl * 1.5,
    alignItems: 'center',
  },
  title: { 
    fontSize: 36,
    fontWeight: '700',
    marginBottom: Spacing.sm,
    textAlign: 'center',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '400',
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 22,
  },
  formContainer: {
    marginBottom: Spacing.xl,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: '#FF3B30', // Red border
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    minHeight: 56,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    paddingVertical: Spacing.md,
  },
  passwordToggle: {
    padding: Spacing.xs,
    marginLeft: Spacing.xs,
  },
  signUpButton: { 
    backgroundColor: '#FF3B30', // Solid red background
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md + 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  signUpButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.xl,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  dividerText: {
    fontSize: 14,
    marginHorizontal: Spacing.md,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
  },
  socialButtonsContainer: {
    marginBottom: Spacing.xl,
    gap: Spacing.md,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md + 4,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  appleButton: {
    backgroundColor: '#000000',
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F1F1F',
  },
  appleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  footerContainer: {
    alignItems: 'center',
    marginTop: Spacing.xl,
  },
  signInLink: {
    marginBottom: Spacing.lg,
  },
  signInText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  signInLinkText: {
    color: '#FF3B30',
    fontWeight: '600',
  },
});

export default SignUpScreen;
