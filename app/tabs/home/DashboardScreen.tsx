import React, { useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { Text, Button } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';

const DashboardScreen = () => {
  const userName = 'User';
  const credits = 5;
  const [image, setImage] = useState<string | null>(null);
  const navigation = useNavigation();

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      setImage(uri);
      navigation.navigate('RecommendationType', { image: uri });
    }
  };

  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={{ marginBottom: 16 }}>
        Welcome, {userName}!
      </Text>
      <Text style={{ marginBottom: 32 }}>
        Credits: {credits}
      </Text>
      {image && (
        <Image source={{ uri: image }} style={styles.imagePreview} />
      )}
      <Button mode="contained" onPress={pickImage} style={{ marginTop: 16 }}>
        Choose a Photo
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  imagePreview: { width: 200, height: 200, marginBottom: 16, borderRadius: 12 },
});

export default DashboardScreen; 