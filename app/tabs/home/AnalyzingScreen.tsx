import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase'; // adjust path as needed
import * as FileSystem from 'expo-file-system';

const statusMessages = [
  'Analyzing your photo...',
  'Finding the perfect song...',
  'Matching mood, style, color...',
];

type AnalyzingParams = { image: string; selectedGenre?: string; userId?: string };
type RootStackParamList = {
  Results: { image: string; songs: any[] };
  // ...other routes
};

async function uploadImageAndGetSignedUrl(localUri: string, userId: string) {
  // Read the file as a base64 string
  const file = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const filePath = `user-images/${userId || 'anonymous'}/${Date.now()}.jpg`;

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

  return data.signedUrl;
}

const AnalyzingScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { image, selectedGenre, userId } = (route.params || {}) as AnalyzingParams;
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % statusMessages.length);
    }, 2000);

    const analyzePhoto = async () => {
      try {
        // 1. Upload the local image and get a signed URL
        const signedUrl = await uploadImageAndGetSignedUrl(image, userId || 'anonymous');
        console.log('Uploaded image signed URL:', signedUrl);

        // 2. Call your Supabase Edge Function with the signed URL
        const payload = { imageUrl: signedUrl, genre: selectedGenre };
        console.log('Calling Supabase Edge Function with:', payload);

        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;

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
    <View style={styles.container}>
      <ActivityIndicator animating size="large" />
      <Text style={styles.status}>{statusMessages[statusIndex]}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  status: { marginTop: 32, fontSize: 18, color: '#555', textAlign: 'center' },
});

export default AnalyzingScreen; 