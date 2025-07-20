import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

// Define the navigation stack param list
 type RootStackParamList = {
   Welcome: undefined;
   SignUp: undefined;
   SignIn: undefined;
 };

const WelcomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={styles.container}>
      {/* Optional: Add your logo here */}
      {/* <Image source={require('../../assets/logo.png')} style={styles.logo} /> */}
      <Text style={styles.title}>VibeMatch</Text>
      <Text style={styles.subtitle}>Find songs that match your vibe!</Text>
      <Button mode="contained" style={styles.button} onPress={() => {}}>
        Continue with Google
      </Button>
      <Button mode="contained" style={styles.button} onPress={() => {}}>
        Continue with Apple
      </Button>
      <Button mode="contained" style={styles.button} onPress={() => navigation.navigate('SignUp')}>
        Continue with Email
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  logo: { width: 100, height: 100, marginBottom: 24 },
  title: { fontSize: 32, fontWeight: 'bold', marginBottom: 16 },
  subtitle: { fontSize: 18, color: '#888', marginBottom: 32 },
  button: { marginVertical: 8, width: 250 },
});

export default WelcomeScreen;