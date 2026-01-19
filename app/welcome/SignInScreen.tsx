import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradientFallback as LinearGradient } from '../../lib/components/LinearGradientFallback';
import { supabase, signInWithApple, signInWithGoogle } from '../../lib/supabase';
import { Colors, Typography, Spacing, Layout, BorderRadius } from '../../lib/designSystem';
import { GuestCreditsModal } from '../../lib/components/GuestCreditsModal';
import { grantGuestFreeCredits } from '../../lib/utils/freeCredits';
import { triggerHaptic } from '../../lib/utils/haptics';

const { width, height } = Dimensions.get('window');

// Define the navigation stack param list
type RootStackParamList = {
  Welcome: undefined;
  SignUp: undefined;
  SignIn: undefined;
  MainTabs: undefined;
};

const SignInScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSignIn = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    triggerHaptic('light');
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      triggerHaptic('error');
      Alert.alert('Sign In Error', error.message);
    } else if (data?.user) {
      triggerHaptic('success');
      // Navigate to main app on successful sign-in
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  };

  const handleGoogleSignIn = async () => {
    triggerHaptic('light');
    setSocialLoading('google');
    try {
      const result = await signInWithGoogle();
      if (result.success) {
        triggerHaptic('success');
        // Navigate to main app on successful sign-in
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      } else if (result.error) {
        triggerHaptic('error');
        Alert.alert('Google Sign-In Error', result.error);
      }
    } catch (error) {
      console.error('Google sign-in error:', error);
      triggerHaptic('error');
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
    setSocialLoading(null);
  };

  const handleAppleSignIn = async () => {
    triggerHaptic('light');
    setSocialLoading('apple');
    try {
      const result = await signInWithApple();
      if (result.success) {
        triggerHaptic('success');
        // Navigate to main app on successful sign-in
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      } else if (result.error) {
        triggerHaptic('error');
        Alert.alert('Apple Sign-In Error', result.error);
      }
    } catch (error) {
      console.error('Apple sign-in error:', error);
      triggerHaptic('error');
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
    setSocialLoading(null);
  };

  const handleSkipForNow = () => {
    triggerHaptic('light');
    setShowGuestModal(true);
  };

  return (
    <View style={styles.container}>
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
              <Text style={styles.title}>Welcome Back</Text>
              <Text style={styles.subtitle}>Sign in to continue your musical journey</Text>
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

              {/* Sign In Button - Solid Red */}
              <TouchableOpacity
                style={styles.signInButton}
                onPress={handleSignIn}
                disabled={loading}
                activeOpacity={0.9}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.signInButtonText}>Sign In</Text>
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
                onPress={handleGoogleSignIn}
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
                  onPress={handleAppleSignIn}
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
                  triggerHaptic('light');
                  navigation.navigate('SignUp');
                }} 
                style={styles.signUpLink}
                activeOpacity={0.7}
              >
                <Text style={styles.signUpText}>
                  Don't have an account?{' '}
                  <Text style={styles.signUpLinkText}>Sign Up</Text>
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                onPress={handleSkipForNow}
                style={styles.skipLink}
                activeOpacity={0.7}
              >
                <Text style={styles.skipText}>Skip for now</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <GuestCreditsModal
        visible={showGuestModal}
        onContinue={async () => {
          triggerHaptic('medium');
          setShowGuestModal(false);
          
          // Grant free credits to guest user
          const granted = await grantGuestFreeCredits();
          if (granted) {
            console.log('✅ Guest free credits granted');
          }
          
          // Navigate to main app
          navigation.navigate('MainTabs');
        }}
        onSignUp={() => {
          triggerHaptic('light');
          setShowGuestModal(false);
          navigation.navigate('SignUp');
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
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
  signInButton: { 
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
  signInButtonText: {
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
  signUpLink: {
    marginBottom: Spacing.lg,
  },
  signUpText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  signUpLinkText: {
    color: '#FF3B30',
    fontWeight: '600',
  },
  skipLink: {
    paddingVertical: Spacing.sm,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#FFFFFF',
    textAlign: 'center',
    textDecorationLine: 'underline',
    opacity: 0.8,
  },
});

export default SignInScreen; 