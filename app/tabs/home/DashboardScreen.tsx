import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { Text, Button } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getUserCredits } from '../../../lib/credits';

const DashboardScreen = () => {
  const userName = 'User';
  const [credits, setCredits] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation();

  useEffect(() => {
    loadUserCredits();
  }, []);

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

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      // Resize and compress the image before using it
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      setImage(manipResult.uri);
      navigation.navigate('RecommendationType', { image: manipResult.uri });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text variant="titleLarge" style={{ marginBottom: 16 }}>
        Welcome, {userName}!
      </Text>
      <Text style={{ marginBottom: 32 }}>
        Credits: {loading ? 'Loading...' : credits}
      </Text>
      {image && (
        <Image source={{ uri: image }} style={styles.imagePreview} />
      )}
      <Button mode="contained" onPress={pickImage} style={{ marginTop: 16 }}>
        Choose a Photo
      </Button>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  imagePreview: { width: 200, height: 200, marginBottom: 16, borderRadius: 12 },
});

export default DashboardScreen; 