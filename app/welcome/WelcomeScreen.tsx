import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FREE_CREDITS_ON_SIGNUP } from '../../lib/credits';

// Define the navigation stack param list
 type RootStackParamList = {
   Welcome: undefined;
   SignUp: undefined;
   SignIn: undefined;
 };

const WelcomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <SafeAreaView style={styles.container}>
      {/* Optional: Add your logo here */}
      {/* <Image source={require('../../assets/logo.png')} style={styles.logo} /> */}
      <Text style={styles.title}>TuneMatch</Text>
      <Text style={styles.subtitle}>Find songs that match your vibe!</Text>
      <Text style={styles.freeTrial}>🎵 Get {FREE_CREDITS_ON_SIGNUP} free credits when you sign up!</Text>
      <Button mode="contained" style={styles.button} onPress={() => {}}>
        Continue with Google
      </Button>
      <Button mode="contained" style={styles.button} onPress={() => {}}>
        Continue with Apple
      </Button>
      <Button mode="contained" style={styles.button} onPress={() => navigation.navigate('SignIn')}>
        Continue with Email
      </Button>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  logo: { width: 100, height: 100, marginBottom: 24 },
  title: { fontSize: 32, fontWeight: 'bold', marginBottom: 16 },
  subtitle: { fontSize: 18, color: '#888', marginBottom: 16 },
  freeTrial: { fontSize: 16, color: '#007AFF', marginBottom: 32, fontWeight: 'bold' },
  button: { marginVertical: 8, width: 250 },
});

export default WelcomeScreen;