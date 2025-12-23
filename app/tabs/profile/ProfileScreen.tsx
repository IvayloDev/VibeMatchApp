import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, ScrollView, Animated, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradientFallback as LinearGradient } from '../../../lib/components/LinearGradientFallback';
import { BlurViewFallback as BlurView } from '../../../lib/components/BlurViewFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { getUserCredits } from '../../../lib/credits';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/AuthContext';
import { Colors, Typography, Spacing, Layout, BorderRadius, Shadows } from '../../../lib/designSystem';
import { FloatingCard } from '../../../lib/components/FloatingCard';
import { ModernButton } from '../../../lib/components/ModernButton';
import { AnimatedCounter } from '../../../lib/components/AnimatedCounter';
import { SkeletonLoader } from '../../../lib/components/SkeletonLoader';
import { triggerHaptic } from '../../../lib/utils/haptics';

type RootStackParamList = {
  Payment: undefined;
  Welcome: undefined;
  SignUp: undefined;
};

const ProfileScreen = () => {
  const { user, signOut } = useAuth();
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const loadUserCredits = async () => {
    try {
      const userCredits = await getUserCredits();
      setCredits(userCredits);
    } catch (error) {
      console.error('Error loading credits:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load credits on mount
  useEffect(() => {
    loadUserCredits();
    
    // Animate on mount
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  // Refresh credits when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadUserCredits();
    }, [])
  );

  const handleSignOut = async () => {
    triggerHaptic('light');
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Sign Out', 
          style: 'destructive',
          onPress: async () => {
            triggerHaptic('medium');
            await signOut();
          }
        }
      ]
    );
  };

  const handleDeleteProfile = () => {
    triggerHaptic('warning');
    Alert.alert(
      'Delete Profile',
      'Are you sure you want to delete your profile? This action cannot be undone and will permanently delete your account and all your data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            triggerHaptic('heavy');
            try {
              console.log('Starting delete profile process...');
              
              // Call the Edge Function to delete the user account
              const { data: { session }, error: sessionError } = await supabase.auth.getSession();
              if (sessionError) {
                console.error('Session error:', sessionError);
                Alert.alert('Error', 'Authentication error. Please sign in again.');
                return;
              }
              const accessToken = session?.access_token;
              
              console.log('Session:', session ? 'Found' : 'Not found');
              console.log('Access token:', accessToken ? 'Present' : 'Missing');

              const response = await fetch('https://mebjzwwtuzwcrwugxjvu.supabase.co/functions/v1/smooth-handler', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
                },
              });

              console.log('Response status:', response.status);
              console.log('Response ok:', response.ok);

              const result = await response.json();
              console.log('Response result:', result);

              if (response.ok && result.success) {
                console.log('Delete successful, signing out...');
                // Sign out to clear session and trigger navigation to welcome
                await signOut();
              } else {
                console.log('Delete failed:', result.error || 'Unknown error');
                Alert.alert('Error', 'Failed to delete profile. Please try again.');
              }
            } catch (error) {
              console.log('Exception during delete:', error);
              Alert.alert('Error', 'Failed to delete profile. Please try again.');
            }
          },
        },
      ]
    );
  };

  const getInitials = (email: string) => {
    if (!email) return 'U';
    const parts = email.split('@')[0];
    return parts.substring(0, 2).toUpperCase();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
          <Text style={styles.headerTitle}>Profile</Text>
        </Animated.View>

        {/* User Info Card */}
        <Animatable.View 
          animation="fadeInUp" 
          duration={600}
          delay={100}
        >
          <FloatingCard style={styles.userCard}>
            <LinearGradient
              colors={[Colors.accent.blue + '20', Colors.accent.coral + '15', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardGradient}
            />
            
            <View style={styles.userCardContent}>
              {/* Avatar */}
              <View style={styles.avatarContainer}>
                <LinearGradient
                  colors={[Colors.accent.blue, Colors.accent.coral]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.avatarGradient}
                >
                  <Text style={styles.avatarText}>
                    {user ? getInitials(user.email || '') : 'GU'}
                  </Text>
                </LinearGradient>
              </View>

              {/* User Info */}
              <View style={styles.userInfo}>
                <Text style={styles.userEmail} numberOfLines={1}>
                  {user?.email || 'Guest User'}
                </Text>
                {!user && (
                  <Text style={styles.guestHint}>
                    Sign up to sync your credits across devices
                  </Text>
                )}
              </View>
            </View>
          </FloatingCard>
        </Animatable.View>

        {/* Credits Card */}
        <Animatable.View 
          animation="fadeInUp" 
          duration={600}
          delay={200}
        >
          <FloatingCard style={styles.creditsCard}>
            <LinearGradient
              colors={[Colors.accent.green + '20', Colors.accent.blue + '15']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardGradient}
            />
            
            <View style={styles.creditsCardContent}>
              <View style={styles.creditsHeader}>
                <View style={styles.creditsIconContainer}>
                  <MaterialCommunityIcons 
                    name="diamond-stone" 
                    size={24} 
                    color={Colors.accent.green} 
                  />
                </View>
                <View style={styles.creditsInfo}>
                  <Text style={styles.creditsLabel}>Available Credits</Text>
                  {loading ? (
                    <SkeletonLoader>
                      <View style={styles.skeletonCredits} />
                    </SkeletonLoader>
                  ) : (
                    <AnimatedCounter 
                      value={credits} 
                      duration={800}
                      style={styles.creditsValue}
                    />
                  )}
                </View>
              </View>

              <ModernButton
                title="💳 Get More Credits"
                onPress={() => {
                  triggerHaptic('light');
                  navigation.navigate('Payment');
                }}
                variant="primary"
                style={styles.buyButton}
              />
            </View>
          </FloatingCard>
        </Animatable.View>

        {/* Bottom Spacing */}
        <View style={styles.bottomSpacing} />
      </ScrollView>

      {/* Account Actions - Fixed at Bottom */}
      <View style={styles.actionsContainer}>
        {user ? (
          // Authenticated user - show Sign Out and Delete Account
          <>
            <TouchableOpacity
              style={styles.smallActionButton}
              onPress={() => {
                triggerHaptic('light');
                handleSignOut();
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.smallActionText}>Sign Out</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.smallActionButton, styles.smallDangerButton]}
              onPress={() => {
                triggerHaptic('light');
                handleDeleteProfile();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.smallActionText, styles.smallDangerText]}>Delete Account</Text>
            </TouchableOpacity>
          </>
        ) : (
          // Guest user - show Create Profile button
          <View style={styles.guestActionsWrapper}>
            <ModernButton
              title="✨ Create Profile"
              onPress={() => {
                triggerHaptic('medium');
                navigation.navigate('SignUp');
              }}
              variant="primary"
              style={styles.createProfileButton}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xl,
  },
  header: {
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerTitle: {
    ...Typography.heading1,
    fontSize: 32,
    fontWeight: '700',
  },
  userCard: {
    marginHorizontal: Layout.screenPadding,
    marginBottom: Spacing.md,
    padding: Spacing.lg,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  userCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
  },
  avatarContainer: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.round,
    overflow: 'hidden',
    ...Shadows.prominent,
  },
  avatarGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    ...Typography.heading2,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  userInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  userEmail: {
    ...Typography.body,
    fontSize: 15,
    fontWeight: '500',
  },
  guestHint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  creditsCard: {
    marginHorizontal: Layout.screenPadding,
    marginBottom: Spacing.md,
    padding: Spacing.lg,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  creditsCardContent: {
    zIndex: 1,
  },
  creditsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  creditsIconContainer: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accent.green + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  creditsInfo: {
    flex: 1,
  },
  creditsLabel: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 14,
    marginBottom: Spacing.xs,
  },
  creditsValue: {
    ...Typography.heading1,
    fontSize: 36,
    fontWeight: '700',
    color: Colors.accent.green,
  },
  skeletonCredits: {
    height: 36,
    width: 80,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.cardBackgroundSecondary,
  },
  buyButton: {
    width: '100%',
  },
  bottomSpacing: {
    height: 100, // Space for bottom action buttons
  },
  actionsContainer: {
    position: 'absolute',
    bottom: 90, // Above tab bar (iOS tab bar is ~90px)
    left: 0,
    right: 0,
    paddingHorizontal: Layout.screenPadding,
    paddingBottom: Spacing.sm,
    paddingTop: Spacing.sm,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border + '40',
    flexDirection: 'row',
    gap: Spacing.sm,
    zIndex: 10,
  },
  smallActionButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 1,
    minHeight: 44,
  },
  smallDangerButton: {
    opacity: 1,
  },
  smallActionText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  smallDangerText: {
    color: Colors.error,
  },
  guestActionsWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createProfileButton: {
    width: '80%',
    maxWidth: 280,
  },
});

export default ProfileScreen;