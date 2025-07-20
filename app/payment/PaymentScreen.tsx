import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

const packages = [
  { credits: 5, price: '$2.99' },
  { credits: 15, price: '$6.99' },
  { credits: 50, price: '$19.99' },
];

const PaymentScreen = () => {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={{ marginBottom: 24 }}>Buy Credits</Text>
      {packages.map((pkg, idx) => (
        <Card key={idx} style={styles.card}>
          <Card.Content>
            <Text style={{ marginBottom: 8 }}>{pkg.credits} credits</Text>
            <Text style={{ marginBottom: 16 }}>{pkg.price}</Text>
            <Button mode="contained" onPress={() => { /* TODO: Integrate payment */ }}>
              Buy
            </Button>
          </Card.Content>
        </Card>
      ))}
      <Button mode="text" style={{ marginTop: 24 }} onPress={() => navigation.goBack()}>
        Cancel
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  card: { width: '100%', marginBottom: 16 },
});

export default PaymentScreen; 