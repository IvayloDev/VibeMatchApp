import React from 'react';
import { View, Text, StyleSheet, Dimensions, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Typography, Spacing, Layout } from '../../lib/designSystem';
import { FloatingCard } from '../../lib/components/FloatingCard';
import { ModernButton } from '../../lib/components/ModernButton';

// Define the navigation stack param list
type RootStackParamList = {
  Welcome: undefined;
  SignUp: undefined;
  SignIn: undefined;
};

const PRIVACY_POLICY_URL = 'https://ivaylodev.github.io/vibematch-privacy-policy/';

const WelcomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width } = Dimensions.get('window');
  
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
            title="Continue"
            onPress={() => navigation.navigate('SignIn')}
            style={styles.continueButton}
          />
          
          <Text style={styles.termsText}>
            By using VibeMatch, you agree to our{'\n'}
            <Text style={styles.linkText}>Terms of Service</Text> and{' '}
            <Text style={styles.linkText} onPress={handlePrivacyPolicyPress}>
              Privacy Policy
            </Text>
          </Text>
        </View>
      </View>
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
  continueButton: {
    width: '100%',
    marginBottom: Spacing.lg,
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