import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Text, Button, Card, IconButton, ActivityIndicator, Badge } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { creditPackages, purchaseCredits, FREE_CREDITS_ON_SIGNUP } from '../../lib/credits';

const PaymentScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState<string | null>(null);

  const handlePurchase = async (packageId: string) => {
    setLoading(packageId);
    try {
      const success = await purchaseCredits(packageId);
      if (success) {
        Alert.alert('Success', 'Credits purchased successfully!');
        navigation.goBack();
      } else {
        Alert.alert('Error', 'Failed to purchase credits. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'An error occurred during purchase.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          size={24}
          onPress={() => navigation.goBack()}
        />
        <Text variant="titleMedium" style={styles.headerTitle}>Buy Credits</Text>
        <View style={{ width: 48 }} />
      </View>
      
      <View style={styles.container}>
        <Text variant="titleMedium" style={styles.subtitle}>
          New users get {FREE_CREDITS_ON_SIGNUP} free credits!
        </Text>
        
        {creditPackages.map((pkg) => (
          <Card 
            key={pkg.id} 
            style={[
              styles.card, 
              pkg.id === '3' && styles.bestValueCard
            ]}
          >
            <Card.Content>
              <View style={styles.cardHeader}>
                <Text variant="titleMedium" style={{ marginBottom: 8 }}>
                  {pkg.credits} Credits
                </Text>
                {pkg.id === '3' && (
                  <Badge style={styles.bestValueBadge}>BEST VALUE</Badge>
                )}
              </View>
              <Text variant="titleLarge" style={{ marginBottom: 16, color: '#007AFF' }}>
                {pkg.price}
              </Text>
              {pkg.id === '3' && (
                <Text style={styles.savingsText}>
                  Save 20% vs smaller packages!
                </Text>
              )}
              <Button 
                mode="contained" 
                onPress={() => handlePurchase(pkg.id)}
                disabled={loading === pkg.id}
                loading={loading === pkg.id}
                style={pkg.id === '3' ? styles.bestValueButton : undefined}
              >
                {loading === pkg.id ? 'Purchasing...' : 'Buy Now'}
              </Button>
            </Card.Content>
          </Card>
        ))}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  container: { flex: 1, alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  subtitle: {
    marginBottom: 24,
    textAlign: 'center',
    color: '#666',
  },
  card: { width: '100%', marginBottom: 16 },
  bestValueCard: {
    borderWidth: 2,
    borderColor: '#007AFF',
    backgroundColor: '#f8f9ff',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  bestValueBadge: {
    backgroundColor: '#007AFF',
  },
  savingsText: {
    color: '#007AFF',
    fontSize: 12,
    marginBottom: 12,
    fontWeight: 'bold',
  },
  bestValueButton: {
    backgroundColor: '#007AFF',
  },
});

export default PaymentScreen; 