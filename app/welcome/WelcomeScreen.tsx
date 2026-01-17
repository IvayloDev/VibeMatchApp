import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Typography, Spacing, Layout } from '../../lib/designSystem';
import { FloatingCard } from '../../lib/components/FloatingCard';
import { ModernButton } from '../../lib/components/ModernButton';
import { GuestCreditsModal } from '../../lib/components/GuestCreditsModal';
import { grantGuestFreeCredits } from '../../lib/utils/freeCredits';
import { triggerHaptic } from '../../lib/utils/haptics';
import { useAuth } from '../../lib/AuthContext';

// Define the navigation stack param list
type RootStackParamList = {
  Welcome: undefined;
  SignUp: undefined;
  SignIn: undefined;
  MainTabs: undefined;
};

const PRIVACY_POLICY_URL = 'https://ivaylodev.github.io/vibematch-privacy-policy/';

const WelcomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, loading } = useAuth();
  const { width } = Dimensions.get('window');
  const [showGuestModal, setShowGuestModal] = useState(false);

  // Redirect to MainTabs if user is already logged in
  useEffect(() => {
    if (!loading && user) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  }, [user, loading, navigation]);
  
  const handlePrivacyPolicyPress = async () => {
    try {
      const supported = await Linking.canOpenURL(PRIVACY_POLICY_URL);
      if (supported) {
        await Linking.openURL(PRIVACY_POLICY_URL);
      } else {
        console.error("Don't know how to open URI: " + PRIVACY_POLICY_URL);
      }
    } catch (error) {
      console.error('Error opening privacy policy:', error);
    }
  };

  const handleContinueAsGuest = async () => {
    triggerHaptic('light');
    setShowGuestModal(true);
  };

  const handleGuestModalContinue = async () => {
    triggerHaptic('medium');
    setShowGuestModal(false);
    
    // Grant free credits to guest user
    const granted = await grantGuestFreeCredits();
    if (granted) {
      console.log('✅ Guest free credits granted');
    }
    
    // Navigate to main app
    navigation.navigate('MainTabs');
  };

  const handleGuestModalSignUp = () => {
    triggerHaptic('light');
    setShowGuestModal(false);
    navigation.navigate('SignUp');
  };
  
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Floating cards section inspired by the design */}
        <View style={styles.cardsContainer}>
          <FloatingCard style={StyleSheet.flatten([styles.floatingCard, styles.card1])}>
            <Text style={styles.cardEmoji}>🎵</Text>
            <Text style={styles.cardTitle}>Discover</Text>
            <Text style={styles.cardSubtitle}>Your Vibe</Text>
          </FloatingCard>
          
          <FloatingCard style={StyleSheet.flatten([styles.floatingCard, styles.card2])}>
            <Text style={styles.cardEmoji}>💫</Text>
            <Text style={styles.cardTitle}>Match</Text>
            <Text style={styles.cardSubtitle}>Perfect Songs</Text>
          </FloatingCard>
          
          <FloatingCard style={StyleSheet.flatten([styles.floatingCard, styles.card3])}>
            <Text style={styles.cardEmoji}>🎯</Text>
            <Text style={styles.cardTitle}>Analyze</Text>
            <Text style={styles.cardSubtitle}>Your Mood</Text>
          </FloatingCard>
        </View>
        
        {/* Main title section inspired by "They are People, Places..." */}
        <View style={styles.titleSection}>
          <Text style={styles.mainTitle}>
            They are{' '}
            <Text style={[styles.mainTitle, { color: Colors.accent.red }]}>Songs</Text>,
          </Text>
          <Text style={styles.mainTitle}>
            <Text style={[styles.mainTitle, { color: Colors.accent.blue }]}>Moods</Text>,{' '}
            <Text style={[styles.mainTitle, { color: Colors.accent.yellow }]}>Vibes</Text>,
          </Text>
          <Text style={styles.mainTitle}>
            &{' '}
            <Text style={[styles.mainTitle, { color: Colors.accent.coral }]}>Memories</Text>.
          </Text>
        </View>
        
        {/* Bottom section */}
        <View style={styles.bottomSection}>
          <ModernButton
            title="Sign In"
            onPress={() => navigation.navigate('SignIn')}
            style={styles.signInButton}
          />
          
          <ModernButton
            title="Create Account"
            onPress={() => navigation.navigate('SignUp')}
            style={styles.createAccountButton}
            variant="secondary"
          />
          
          <Text 
            style={styles.skipText}
            onPress={handleContinueAsGuest}
          >
            Continue as guest
          </Text>
          
          <Text style={styles.termsText}>
            By using VibeMatch, you agree to our{'\n'}
            <Text style={styles.linkText}>Terms of Service</Text> and{' '}
            <Text style={styles.linkText} onPress={handlePrivacyPolicyPress}>
              Privacy Policy
            </Text>
          </Text>
        </View>
      </View>

      <GuestCreditsModal
        visible={showGuestModal}
        onContinue={handleGuestModalContinue}
        onSignUp={handleGuestModalSignUp}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background,
  },
  content: { 
    flex: 1, 
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.xl,
  },
  cardsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  floatingCard: {
    position: 'absolute',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card1: {
    top: -20,
    left: 20,
    transform: [{ rotate: '-15deg' }],
  },
  card2: {
    top: 40,
    right: 30,
    transform: [{ rotate: '10deg' }],
  },
  card3: {
    bottom: 20,
    left: 40,
    transform: [{ rotate: '5deg' }],
  },
  cardEmoji: {
    fontSize: 32,
    marginBottom: Spacing.sm,
  },
  cardTitle: {
    ...Typography.heading3,
    fontSize: 16,
    marginBottom: 2,
  },
  cardSubtitle: {
    ...Typography.caption,
    fontSize: 12,
    textAlign: 'center',
  },
  titleSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xxxl,
  },
  mainTitle: {
    ...Typography.display,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  bottomSection: {
    alignItems: 'center',
    paddingBottom: Spacing.xl,
  },
  signInButton: {
    width: '100%',
    marginBottom: Spacing.md,
  },
  createAccountButton: {
    width: '100%',
    marginBottom: Spacing.lg,
  },
  skipText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 14,
    marginBottom: Spacing.lg,
    textDecorationLine: 'underline',
    opacity: 0.7,
  },
  termsText: {
    ...Typography.caption,
    textAlign: 'center',
    lineHeight: 18,
  },
  linkText: {
    color: Colors.accent.blue,
    textDecorationLine: 'underline',
  },
});

export default WelcomeScreen;