import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getUserCredits } from '../../../lib/credits';

const ProfileScreen = () => {
  // Placeholder data
  const user = { email: 'user@example.com', name: 'User' };
  const [credits, setCredits] = useState(0);
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

  return (
    <SafeAreaView style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleLarge" style={{ marginBottom: 8 }}>{user.name}</Text>
          <Text style={{ marginBottom: 16 }}>{user.email}</Text>
          <Text style={{ marginBottom: 16 }}>Credits: {loading ? 'Loading...' : credits}</Text>
          <Button mode="contained" style={{ marginBottom: 16 }} onPress={() => navigation.navigate('Payment')}>
            Buy More Credits
          </Button>
          <Button mode="outlined" onPress={() => { /* TODO: Logout */ }}>
            Logout
          </Button>
        </Card.Content>
      </Card>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  card: { width: '90%', padding: 16 },
});

export default ProfileScreen; 