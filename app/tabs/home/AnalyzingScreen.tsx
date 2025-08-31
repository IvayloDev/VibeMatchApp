import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Image, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { Colors, Typography, Spacing, BorderRadius } from '../../../lib/designSystem';

type AnalyzingParams = { image: string; selectedGenre?: string; userId?: string };
type RootStackParamList = {
  Results: { image: string; songs: any[] };
  Payment: undefined;
  // ...other routes
};

async function uploadImageAndGetSignedUrl(localUri: string, userId: string) {
  // Convert local URI to base64
  const response = await fetch(localUri);
  const blob = await response.blob();
  const reader = new FileReader();
  
  return new Promise<{ filePath: string; signedUrl: string }>((resolve, reject) => {
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const file = base64.split(',')[1]; // Remove data:image/jpeg;base64, prefix
        
        // Create unique file path
        const filePath = `${userId}/${Date.now()}.jpg`;

        // Convert base64 to Uint8Array
        const byteArray = Uint8Array.from(atob(file), c => c.charCodeAt(0));

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(filePath, byteArray, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadError) throw uploadError;

        // Get a signed URL (valid for 1 hour)
        const { data, error: signedUrlError } = await supabase.storage
          .from('images')
          .createSignedUrl(filePath, 60 * 60);

        if (signedUrlError) throw signedUrlError;

        resolve({ filePath, signedUrl: data.signedUrl });
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsDataURL(blob);
  });
}

const AnalyzingScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { image, selectedGenre, userId } = (route.params || {}) as AnalyzingParams;
  const [statusIndex, setStatusIndex] = useState(0);
  const [statusMessages] = useState([
    'Analyzing your photo...',
    'Detecting mood and style...',
    'Finding perfect songs...',
    'Almost ready...',
  ]);
  
  // Animation for pulsing image
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Hide tab bar when this screen is focused
  useFocusEffect(
    React.useCallback(() => {
      // Try to hide the tab bar
      const parent = navigation.getParent();
      if (parent) {
        parent.setOptions({
          tabBarStyle: { display: 'none' }
        });
      }

      return () => {
        // Show tab bar when leaving this screen
        if (parent) {
          parent.setOptions({
            tabBarStyle: { display: 'flex' }
          });
        }
      };
    }, [navigation])
  );

  useEffect(() => {
    // Start pulsing animation
    const startPulsing = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    };
    
    startPulsing();
    
    const interval = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % statusMessages.length);
    }, 2000);

    const analyzePhoto = async () => {
      try {
        // 1. Upload the local image and get a signed URL
        const { filePath, signedUrl } = await uploadImageAndGetSignedUrl(image, userId || 'anonymous');
        console.log('Uploaded image signed URL:', signedUrl);

        // 2. Call your Supabase Edge Function with the signed URL
        const payload = { imageUrl: signedUrl, genre: selectedGenre };
        console.log('Calling Supabase Edge Function with:', payload);

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.error('Session error:', sessionError);
          throw new Error('Authentication error. Please sign in again.');
        }
        const accessToken = session?.access_token;
        const currentUserId = session?.user?.id;

        const response = await fetch('https://mebjzwwtuzwcrwugxjvu.supabase.co/functions/v1/recommend-songs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
          },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        console.log('Received response:', data);

        // Save to Supabase history table
        if (currentUserId && filePath && data.songs) {
          const { error } = await supabase.from('history').insert([
            {
              user_id: currentUserId,
              image_url: filePath,
              songs: data.songs,
            },
          ]);
          if (error) {
            console.error('Error saving history:', error);
          }
        }

        navigation.navigate('Results', { image: signedUrl, songs: data.songs });
      } catch (error) {
        console.log('Error during analysis:', error);
        navigation.navigate('Results', { image, songs: [] });
      }
    };

    analyzePhoto();

    return () => clearInterval(interval);
  }, [navigation, image, selectedGenre, userId]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Show the image being analyzed with pulsing animation */}
      <Animated.View 
        style={[
          styles.imageContainer,
          {
            transform: [{ scale: pulseAnim }],
          }
        ]}
      >
        <Image source={{ uri: image }} style={styles.image} />
      </Animated.View>
      
      <ActivityIndicator 
        animating 
        size="large" 
        color={Colors.accent.blue}
        style={styles.loader}
      />
      <Text style={styles.status}>{statusMessages[statusIndex]}</Text>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: Colors.background,
  },
  imageContainer: {
    width: 200,
    height: 200,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.xl,
    shadowColor: Colors.accent.blue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: BorderRadius.lg,
  },
  loader: {
    marginVertical: Spacing.lg,
  },
  status: { 
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
});

export default AnalyzingScreen; 