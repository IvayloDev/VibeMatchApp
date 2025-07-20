import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

const ProfileScreen = () => {
  // Placeholder data
  const user = { email: 'user@example.com', name: 'User' };
  const credits = 5;
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleLarge" style={{ marginBottom: 8 }}>{user.name}</Text>
          <Text style={{ marginBottom: 16 }}>{user.email}</Text>
          <Text style={{ marginBottom: 16 }}>Credits: {credits}</Text>
          <Button mode="contained" style={{ marginBottom: 16 }} onPress={() => navigation.navigate('Payment')}>
            Buy More Credits
          </Button>
          <Button mode="outlined" onPress={() => { /* TODO: Logout */ }}>
            Logout
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  card: { width: '90%', padding: 16 },
});

export default ProfileScreen; 