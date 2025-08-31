import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getUserCredits } from '../../../lib/credits';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/AuthContext';
import { Colors, Typography, Spacing, Layout, BorderRadius } from '../../../lib/designSystem';

type RootStackParamList = {
  Payment: undefined;
  Welcome: undefined;
};

const ProfileScreen = () => {
  const { user, signOut } = useAuth();
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

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
  }, []);

  // Refresh credits when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadUserCredits();
    }, [])
  );

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Sign Out', 
          style: 'destructive',
          onPress: async () => {
            await signOut();
          }
        }
      ]
    );
  };

  const handleDeleteProfile = () => {
    Alert.alert(
      'Delete Profile',
      'Are you sure you want to delete your profile? This action cannot be undone and will permanently delete your account and all your data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
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
                console.log('Delete successful, navigating to welcome...');
                // Navigate to welcome screen
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Welcome' }],
                });
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text variant="titleLarge" style={styles.title}>Profile</Text>
        
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">User Information</Text>
            <Text variant="bodyMedium" style={styles.email}>
              {user?.email || 'user@example.com'}
            </Text>
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">Credits</Text>
            <Text variant="bodyLarge" style={styles.credits}>
              {loading ? 'Loading...' : `${credits} credits remaining`}
            </Text>
            <Button 
              mode="contained" 
              style={styles.buyButton}
              onPress={() => navigation.navigate('Payment')}
            >
              Buy More Credits
            </Button>
          </Card.Content>
        </Card>

        <Button 
          mode="outlined" 
          style={styles.signOutButton}
          onPress={handleSignOut}
        >
          Sign Out
        </Button>

        <Button 
          mode="outlined" 
          style={[styles.deleteButton, { borderColor: '#ff4444' }]}
          labelStyle={{ color: '#ff4444' }}
          onPress={handleDeleteProfile}
        >
          Delete Profile
        </Button>
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
    width: '100%',
    padding: Layout.screenPadding,
    paddingTop: Spacing.xl,
  },
  title: {
    ...Typography.heading1,
    marginBottom: Spacing.xl,
    textAlign: 'center',
  },
  card: {
    marginBottom: Spacing.md,
    backgroundColor: Colors.cardBackground,
    borderRadius: BorderRadius.md,
  },
  email: {
    ...Typography.body,
    marginTop: Spacing.sm,
  },
  credits: {
    ...Typography.heading3,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    color: Colors.accent.green,
  },
  buyButton: {
    marginTop: Spacing.sm,
  },
  signOutButton: {
    marginTop: Spacing.xl,
    borderColor: Colors.border,
  },
  deleteButton: {
    marginTop: Spacing.md,
    borderColor: Colors.accent.red,
  },
});

export default ProfileScreen; 