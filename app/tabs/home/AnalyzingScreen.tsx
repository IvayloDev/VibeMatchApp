import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

const statusMessages = [
  'Analyzing your photo...',
  'Finding the perfect song...',
  'Matching mood, style, color...',
];

type AnalyzingParams = { image: string; selectedGenre?: string };
type RootStackParamList = {
  Results: { image: string; songs: any[] };
  // ...other routes
};

const AnalyzingScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { image, selectedGenre } = (route.params || {}) as AnalyzingParams;
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % statusMessages.length);
    }, 2000);

    // Call your Supabase Edge Function
    const analyzePhoto = async () => {
      try {
        const response = await fetch('https://mebjzwwtuzwcrwugxjvu.functions.supabase.co/recommend-songs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: image, genre: selectedGenre }),
        });
        const data = await response.json();
        navigation.navigate('Results', { image, songs: data.songs });
      } catch (error) {
        // Handle error (show a message, etc.)
        navigation.navigate('Results', { image, songs: [] });
      }
    };

    analyzePhoto();

    return () => clearInterval(interval);
  }, [navigation, image, selectedGenre]);

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