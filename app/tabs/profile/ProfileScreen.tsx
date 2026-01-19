import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, ScrollView, Animated, TouchableOpacity, Dimensions, Image } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation, useFocusEffect, CommonActions } from '@react-navigation/native';
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
import { AnimatedCounter } from '../../../lib/components/AnimatedCounter';
import { triggerHaptic } from '../../../lib/utils/haptics';

const { width, height } = Dimensions.get('window');

type RootStackParamList = {
  Payment: undefined;
  Welcome: undefined;
  SignUp: undefined;
  MainTabs: undefined;
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
            
            // Navigate to Welcome screen after sign out
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Welcome' }],
              })
            );
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
                
                // Navigate to Welcome screen after account deletion
                navigation.dispatch(
                  CommonActions.reset({
                    index: 0,
                    routes: [{ name: 'Welcome' }],
                  })
                );
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

  const getUserName = () => {
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (user?.email) {
      const emailName = user.email.split('@')[0];
      return emailName.charAt(0).toUpperCase() + emailName.slice(1);
    }
    return 'Guest User';
  };


  const getAvatarUrl = () => {
    return user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Background Blur Effects */}
      <View style={styles.backgroundBlur1} />
      <View style={styles.backgroundBlur2} />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
          <Text style={styles.headerTitle}>Profile</Text>
        </Animated.View>

        {/* User Profile Section */}
        <Animatable.View 
          animation="fadeInUp" 
          duration={600}
          delay={100}
          style={styles.userSection}
        >
          <View style={styles.userProfileRow}>
            {/* Avatar with Edit Button */}
            <View style={styles.avatarContainer}>
              {getAvatarUrl() ? (
                <Image 
                  source={{ uri: getAvatarUrl() }} 
                  style={styles.avatarImage}
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitials}>
                    {getInitials(getUserName())}
                  </Text>
                </View>
              )}
              <TouchableOpacity 
                style={styles.editAvatarButton}
                onPress={() => {
                  triggerHaptic('light');
                  // TODO: Implement avatar edit
                }}
              >
                <MaterialCommunityIcons name="pencil" size={10} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* User Info */}
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{getUserName()}</Text>
            </View>
          </View>
        </Animatable.View>

        {/* Credit Balance Card */}
        <Animatable.View 
          animation="fadeInUp" 
          duration={600}
          delay={200}
          style={styles.creditCardContainer}
        >
          <LinearGradient
            colors={['#FF3B30', '#FF2D55']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.creditCard}
          >
            {/* Decorative circle */}
            <View style={styles.creditCardDecoration} />
            
            <View style={styles.creditCardContent}>
              <View style={styles.creditCardHeader}>
                <View style={styles.creditCardText}>
                  <Text style={styles.creditBalanceLabel}>Credit Balance</Text>
                  <View style={styles.creditBalanceValue}>
                    {loading ? (
                      <View style={styles.skeletonCredits} />
                    ) : (
                      <AnimatedCounter 
                        value={credits} 
                        duration={800}
                        style={styles.creditNumber}
                      />
                    )}
                  </View>
                </View>
                <View style={styles.creditCardIcon}>
                  <MaterialCommunityIcons name="auto-fix" size={28} color="#FFFFFF" />
                </View>
              </View>

              <TouchableOpacity
                style={styles.topUpButton}
                onPress={() => {
                  triggerHaptic('medium');
                  navigation.navigate('Payment');
                }}
                activeOpacity={0.9}
              >
                <MaterialCommunityIcons name="plus-circle" size={16} color="#FF3B30" />
                <Text style={styles.topUpButtonText}>Top Up Balance</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animatable.View>

        {/* Sign Out Button */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="logout" size={20} color="#FF3B30" />
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>

        {/* Delete Profile Button */}
        <TouchableOpacity
          style={styles.deleteProfileButton}
          onPress={handleDeleteProfile}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="delete" size={20} color="#FF453A" />
          <Text style={styles.deleteProfileButtonText}>Delete Profile</Text>
        </TouchableOpacity>

        {/* Bottom Spacing */}
        <View style={styles.bottomSpacing} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1,
    backgroundColor: '#221019', // Matching DashboardScreen background
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xl,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  userSection: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  userProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: Spacing.md,
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FF3B30',
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FF3B30',
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  editAvatarButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF3B30',
    borderWidth: 2,
    borderColor: '#221019',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  creditCardContainer: {
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.xl,
  },
  creditCard: {
    borderRadius: 24,
    padding: Spacing.lg,
    position: 'relative',
    overflow: 'hidden',
    ...Shadows.prominent,
    shadowColor: '#FF3B30',
    shadowOpacity: 0.3,
  },
  creditCardDecoration: {
    position: 'absolute',
    right: -40,
    top: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  creditCardContent: {
    position: 'relative',
    zIndex: 1,
  },
  creditCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  creditCardText: {
    flex: 1,
    minWidth: 0, // Allow flex to shrink
    marginRight: Spacing.md, // Add spacing before icon
  },
  creditBalanceLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.8)',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 4,
  },
  creditBalanceValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap', // Allow wrapping if needed
  },
  creditNumber: {
    fontSize: 48,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 56, // Ensure proper line height
    minWidth: 60, // Minimum width for number display
  },
  creditCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0, // Don't shrink the icon
  },
  topUpButton: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  topUpButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FF3B30',
  },
  signOutButton: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.md,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  signOutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF3B30',
  },
  deleteProfileButton: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteProfileButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF453A',
  },
  bottomSpacing: {
    height: 20,
  },
  skeletonCredits: {
    height: 36,
    width: 80,
    borderRadius: BorderRadius.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  backgroundBlur1: {
    position: 'absolute',
    top: -height * 0.1,
    left: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: '#f4258c20', // Pink/primary color matching DashboardScreen
    borderRadius: 9999,
    opacity: 0.3,
    zIndex: 0,
  },
  backgroundBlur2: {
    position: 'absolute',
    bottom: -height * 0.1,
    right: -width * 0.2,
    width: width * 0.8,
    height: height * 0.5,
    backgroundColor: '#8b5cf620', // Purple accent matching DashboardScreen
    borderRadius: 9999,
    opacity: 0.3,
    zIndex: 0,
  },
});

export default ProfileScreen;
