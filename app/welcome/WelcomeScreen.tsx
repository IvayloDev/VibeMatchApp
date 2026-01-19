import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Linking, TouchableOpacity, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradientFallback as LinearGradient } from '../../lib/components/LinearGradientFallback';
import { GuestCreditsModal } from '../../lib/components/GuestCreditsModal';
import { grantGuestFreeCredits } from '../../lib/utils/freeCredits';
import { triggerHaptic } from '../../lib/utils/haptics';
import { useAuth } from '../../lib/AuthContext';
import { Colors, Typography, Spacing, Layout, BorderRadius } from '../../lib/designSystem';

// Define the navigation stack param list
type RootStackParamList = {
  Welcome: undefined;
  SignUp: undefined;
  SignIn: undefined;
  MainTabs: undefined;
};

const PRIVACY_POLICY_URL = 'https://ivaylodev.github.io/vibematch-privacy-policy/';

const { width, height } = Dimensions.get('window');

const WelcomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, loading } = useAuth();
  const [showGuestModal, setShowGuestModal] = useState(false);

  // Animation values for wave effect
  const card1Anim = useRef(new Animated.Value(0)).current;
  const card2Anim = useRef(new Animated.Value(0)).current;
  const card3Anim = useRef(new Animated.Value(0)).current;

  // Wave animation - cards move up and down in sequence
  useEffect(() => {
    const createWaveAnimation = () => {
      // Create animations with different delays for wave effect
      const animation1 = Animated.loop(
        Animated.sequence([
          Animated.timing(card1Anim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(card1Anim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      );

      const animation2 = Animated.loop(
        Animated.sequence([
          Animated.delay(400), // Start 400ms after card1
          Animated.timing(card2Anim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(card2Anim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      );

      const animation3 = Animated.loop(
        Animated.sequence([
          Animated.delay(800), // Start 800ms after card1
          Animated.timing(card3Anim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(card3Anim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      );

      // Start all animations
      animation1.start();
      animation2.start();
      animation3.start();

      return () => {
        animation1.stop();
        animation2.stop();
        animation3.stop();
      };
    };

    createWaveAnimation();
  }, []);

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
    <View style={styles.container}>
      {/* Background Blur Effects */}
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />
      
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          {/* Feature Cards Section */}
          <View style={styles.cardsContainer}>
            {/* Card 1: Discover */}
            <Animated.View 
              style={[
                styles.featureCard, 
                styles.card1,
                {
                  transform: [
                    { rotate: '-8deg' },
                    { 
                      translateY: card1Anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-10, -25], // Moves from -10 to -25 (up)
                      })
                    }
                  ],
                }
              ]}
            >
              <View style={styles.cardGlow} />
              <MaterialCommunityIcons 
                name="music-note-outline" 
                size={32} 
                color="#FF3B30" 
                style={styles.cardIcon}
              />
              <Text style={styles.cardTitle}>Discover</Text>
              <Text style={styles.cardSubtitle}>Your Vibe</Text>
            </Animated.View>
            
            {/* Card 2: Match */}
            <Animated.View 
              style={[
                styles.featureCard, 
                styles.card2,
                {
                  transform: [
                    { 
                      translateY: card2Anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [10, -5], // Moves from 10 to -5 (up)
                      })
                    }
                  ],
                  zIndex: 1,
                }
              ]}
            >
              <View style={styles.cardGlow} />
              <MaterialCommunityIcons 
                name="star-outline" 
                size={32} 
                color="#FF3B30" 
                style={styles.cardIcon}
              />
              <Text style={styles.cardTitle}>Match</Text>
              <Text style={styles.cardSubtitle}>Perfect Songs</Text>
            </Animated.View>
            
            {/* Card 3: Analyze */}
            <Animated.View 
              style={[
                styles.featureCard, 
                styles.card3,
                {
                  transform: [
                    { rotate: '8deg' },
                    { 
                      translateY: card3Anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-10, -25], // Moves from -10 to -25 (up)
                      })
                    }
                  ],
                }
              ]}
            >
              <View style={styles.cardGlow} />
              <MaterialCommunityIcons 
                name="target" 
                size={32} 
                color="#FF3B30" 
                style={styles.cardIcon}
              />
              <Text style={styles.cardTitle}>Analyze</Text>
              <Text style={styles.cardSubtitle}>Your Mood</Text>
            </Animated.View>
          </View>
          
          {/* Main Title Section */}
          <View style={styles.titleSection}>
            <Text style={styles.mainTitle}>
              They are{' '}
              <Text style={styles.highlightedText}>Songs</Text>,
            </Text>
            <Text style={styles.mainTitle}>
              <Text style={styles.highlightedText}>Moods</Text>,{' '}
              <Text style={styles.highlightedText}>Vibes</Text>,
            </Text>
            <Text style={styles.mainTitle}>
              &{' '}
              <Text style={styles.highlightedText}>Memories</Text>.
            </Text>
          </View>
          
          {/* Action Buttons Section */}
          <View style={styles.bottomSection}>
            {/* Sign In Button - White */}
            <TouchableOpacity
              style={styles.signInButton}
              onPress={() => {
                triggerHaptic('light');
                navigation.navigate('SignIn');
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.signInButtonText}>Sign In</Text>
            </TouchableOpacity>
            
            {/* Create Account Button - Dark Grey */}
            <TouchableOpacity
              style={styles.createAccountButton}
              onPress={() => {
                triggerHaptic('light');
                navigation.navigate('SignUp');
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.createAccountButtonText}>Create Account</Text>
            </TouchableOpacity>
            
            {/* Continue as Guest Link */}
            <TouchableOpacity
              onPress={handleContinueAsGuest}
              activeOpacity={0.7}
            >
              <Text style={styles.guestText}>Continue as guest</Text>
            </TouchableOpacity>
            
            {/* Legal Disclaimer */}
            <View style={styles.legalSection}>
              <Text style={styles.legalText}>
                By using VibeMatch, you agree to our{' '}
              </Text>
              <View style={styles.legalLinks}>
                <TouchableOpacity onPress={handlePrivacyPolicyPress} activeOpacity={0.7}>
                  <Text style={styles.legalLink}>Terms of Service</Text>
                </TouchableOpacity>
                <Text style={styles.legalText}> and </Text>
                <TouchableOpacity onPress={handlePrivacyPolicyPress} activeOpacity={0.7}>
                  <Text style={styles.legalLink}>Privacy Policy</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </SafeAreaView>

      <GuestCreditsModal
        visible={showGuestModal}
        onContinue={handleGuestModalContinue}
        onSignUp={handleGuestModalSignUp}
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
  content: {
    flex: 1,
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  cardsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingTop: Spacing.xxl,
  },
  featureCard: {
    width: (width - Layout.screenPadding * 2 - Spacing.sm * 2) / 3,
    aspectRatio: 0.85,
    backgroundColor: 'rgba(28, 28, 30, 0.6)',
    borderRadius: BorderRadius.xl,
    borderWidth: 1.5,
    borderColor: '#FF3B3040', // Red-orange glow
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
    position: 'relative',
    overflow: 'hidden',
    // Subtle rotation for overlapping effect
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  cardGlow: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: '#FF3B30',
    opacity: 0.3,
  },
  card1: {
    // Transform is now handled by Animated.View
  },
  card2: {
    // Transform is now handled by Animated.View
  },
  card3: {
    // Transform is now handled by Animated.View
  },
  cardIcon: {
    marginBottom: Spacing.sm,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  cardSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  titleSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xxl,
    alignItems: 'center',
  },
  mainTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 42,
    letterSpacing: -0.5,
  },
  highlightedText: {
    color: '#FF3B30', // Red-orange highlight
  },
  bottomSection: {
    alignItems: 'center',
    paddingBottom: Spacing.lg,
  },
  signInButton: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.xl,
    paddingVertical: Spacing.md + 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  signInButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  createAccountButton: {
    width: '100%',
    backgroundColor: '#1C1C1E',
    borderRadius: BorderRadius.xl,
    paddingVertical: Spacing.md + 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  createAccountButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  guestText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: Spacing.xl,
  },
  legalSection: {
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
  },
  legalText: {
    fontSize: 11,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 16,
  },
  legalLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  legalLink: {
    fontSize: 11,
    fontWeight: '500',
    color: '#FF3B30',
    textDecorationLine: 'underline',
  },
});

export default WelcomeScreen;
