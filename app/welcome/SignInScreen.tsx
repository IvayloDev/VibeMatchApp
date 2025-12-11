import React from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView, Dimensions } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradientFallback as LinearGradient } from '../../lib/components/LinearGradientFallback';
import { supabase, signInWithApple, signInWithGoogle } from '../../lib/supabase';
import { Colors, Typography, Spacing, Layout } from '../../lib/designSystem';

const { width, height } = Dimensions.get('window');

// Define the navigation stack param list
type RootStackParamList = {
  Welcome: undefined;
  SignUp: undefined;
  SignIn: undefined;
  MainTabs: undefined;
};

const SignInScreen = () => {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [loading, setLoading] = React.useState(false);
  const [socialLoading, setSocialLoading] = React.useState<'google' | 'apple' | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      Alert.alert('Sign In Error', error.message);
    }
    // Navigation is now handled automatically by AuthContext
  };

  const handleGoogleSignIn = async () => {
    setSocialLoading('google');
    try {
      const result = await signInWithGoogle();
      if (!result.success && result.error) {
        Alert.alert('Google Sign-In Error', result.error);
      }
      // Navigation is handled automatically by AuthContext on success
    } catch (error) {
      console.error('Google sign-in error:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
    setSocialLoading(null);
  };

  const handleAppleSignIn = async () => {
    setSocialLoading('apple');
    try {
      const result = await signInWithApple();
      if (!result.success && result.error) {
        Alert.alert('Apple Sign-In Error', result.error);
      }
      // Navigation is handled automatically by AuthContext on success
    } catch (error) {
      console.error('Apple sign-in error:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
    setSocialLoading(null);
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#1a1a2e', '#16213e', '#0f3460']}
        locations={[0, 0.6, 1]}
        style={styles.gradientBackground}
      >
        {/* Background decorative elements */}
        <View style={styles.backgroundElements}>
          <View style={[styles.circle, styles.circle1]} />
          <View style={[styles.circle, styles.circle2]} />
          <View style={[styles.circle, styles.circle3]} />
          <View style={[styles.musicNote, styles.musicNote1]}>
            <MaterialCommunityIcons name="music-note" size={24} color="rgba(100,200,255,0.15)" />
          </View>
          <View style={[styles.musicNote, styles.musicNote2]}>
            <MaterialCommunityIcons name="music" size={32} color="rgba(100,200,255,0.1)" />
          </View>
          <View style={[styles.musicNote, styles.musicNote3]}>
            <MaterialCommunityIcons name="music-note-eighth" size={20} color="rgba(100,200,255,0.18)" />
          </View>
        </View>
        
        <KeyboardAvoidingView 
          style={styles.keyboardContainer} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView 
            contentContainerStyle={styles.scrollContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.headerContainer}>
              <Text variant="displaySmall" style={styles.title}>Welcome Back</Text>
              <Text variant="bodyLarge" style={styles.subtitle}>Sign in to continue your musical journey</Text>
            </View>
            
            <View style={styles.formContainer}>
          <View style={styles.inputContainer}>
            <TextInput
              label="Email Address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              mode="outlined"
              left={<TextInput.Icon icon="email-outline" />}
            />
          </View>
          <View style={styles.inputContainer}>
            <TextInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              style={styles.input}
              mode="outlined"
              left={<TextInput.Icon icon="lock-outline" />}
            />
          </View>
          <Button 
            mode="contained" 
            onPress={handleSignIn} 
            style={styles.signInButton} 
            contentStyle={styles.buttonContent}
            loading={loading} 
            disabled={loading}
          >
            Sign In
          </Button>
        </View>

        <View style={styles.dividerContainer}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.divider} />
        </View>

        <View style={styles.socialButtonsContainer}>
          <TouchableOpacity 
            style={[styles.socialButton, styles.googleButton, socialLoading === 'google' && styles.socialButtonDisabled]} 
            onPress={handleGoogleSignIn}
            disabled={socialLoading !== null}
          >
            <View style={styles.socialIconContainer}>
              {socialLoading === 'google' ? (
                <MaterialCommunityIcons name="loading" size={22} color="#DB4437" />
              ) : (
                <MaterialCommunityIcons name="google" size={22} color="#DB4437" />
              )}
            </View>
            <Text style={[styles.socialButtonText, styles.googleButtonText]}>
              {socialLoading === 'google' ? 'Signing in...' : 'Continue with Google'}
            </Text>
          </TouchableOpacity>
          
          {Platform.OS === 'ios' && (
            <TouchableOpacity 
              style={[styles.socialButton, styles.appleButton, socialLoading === 'apple' && styles.socialButtonDisabled]} 
              onPress={handleAppleSignIn}
              disabled={socialLoading !== null}
            >
              <View style={styles.socialIconContainer}>
                {socialLoading === 'apple' ? (
                  <MaterialCommunityIcons name="loading" size={22} color="#FFFFFF" />
                ) : (
                  <MaterialCommunityIcons name="apple" size={22} color="#FFFFFF" />
                )}
              </View>
              <Text style={[styles.socialButtonText, styles.appleButtonText]}>
                {socialLoading === 'apple' ? 'Signing in...' : 'Continue with Apple'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

            <TouchableOpacity onPress={() => navigation.navigate('SignUp')} style={styles.linkContainer}>
              <Text style={styles.linkText}>Don't have an account? Sign Up</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1,
  },
  gradientBackground: {
    flex: 1,
    position: 'relative',
  },
  backgroundElements: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  circle: {
    position: 'absolute',
    borderRadius: 100,
    backgroundColor: 'rgba(100,200,255,0.03)',
  },
  circle1: {
    width: 200,
    height: 200,
    top: -50,
    right: -50,
  },
  circle2: {
    width: 150,
    height: 150,
    top: height * 0.3,
    left: -75,
  },
  circle3: {
    width: 100,
    height: 100,
    bottom: 100,
    right: 50,
  },
  musicNote: {
    position: 'absolute',
  },
  musicNote1: {
    top: height * 0.15,
    right: 80,
  },
  musicNote2: {
    top: height * 0.7,
    left: 40,
  },
  musicNote3: {
    top: height * 0.45,
    right: 30,
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContainer: { 
    flexGrow: 1,
    justifyContent: 'center',
    padding: Layout.screenPadding,
    paddingTop: 80,
    paddingBottom: 40,
  },
  headerContainer: {
    marginBottom: Spacing.xl * 1.5,
    alignItems: 'center',
  },
  title: { 
    ...Typography.heading1,
    fontSize: 32,
    fontWeight: '700',
    marginBottom: Spacing.sm,
    textAlign: 'center',
    color: '#FFFFFF',
  },
  subtitle: {
    ...Typography.body,
    fontSize: 16,
    marginBottom: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.8)',
    opacity: 0.9,
  },
  formContainer: {
    marginBottom: Spacing.xl,
  },
  inputContainer: {
    marginBottom: Spacing.md,
  },
  input: { 
    backgroundColor: Colors.cardBackground,
    borderRadius: 12,
  },
  signInButton: { 
    marginTop: Spacing.lg,
    borderRadius: 12,
    elevation: 2,
    shadowColor: Colors.accent.blue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  buttonContent: {
    paddingVertical: Spacing.sm,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.xl,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
    opacity: 0.3,
  },
  dividerText: {
    ...Typography.caption,
    marginHorizontal: Spacing.lg,
    color: 'rgba(255,255,255,0.6)',
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
    paddingVertical: Spacing.md + 2,
    paddingHorizontal: Spacing.lg,
    borderRadius: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
  },
  appleButton: {
    backgroundColor: '#000000',
    borderWidth: 0,
  },
  socialButtonDisabled: {
    opacity: 0.6,
  },
  socialIconContainer: {
    marginRight: Spacing.sm,
  },
  socialButtonText: {
    ...Typography.body,
    fontWeight: '600',
    fontSize: 16,
  },
  googleButtonText: {
    color: '#1F1F1F',
  },
  appleButtonText: {
    color: '#FFFFFF',
  },
  linkContainer: { 
    marginTop: Spacing.lg,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  linkText: { 
    ...Typography.body,
    color: Colors.accent.blue,
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 16,
  },
});

export default SignInScreen; 