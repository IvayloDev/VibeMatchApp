import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Alert, ScrollView } from 'react-native';
import { Text, Button, IconButton, ActivityIndicator } from 'react-native-paper';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradientFallback as LinearGradient } from '../../lib/components/LinearGradientFallback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PurchasesPackage } from 'react-native-purchases';
import {
  getAvailablePackages,
  purchasePackage,
  getCreditsForProduct,
} from '../../lib/revenuecat';
import { getUserCredits, getLocalCredits, addLocalCredits, storeLocalPurchase } from '../../lib/credits';
import { validatePurchase } from '../../lib/supabase';
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../lib/designSystem';
import { triggerHaptic } from '../../lib/utils/haptics';
import { useAuth } from '../../lib/AuthContext';

// Package display configuration
const PACKAGE_CONFIG: Record<string, {
  label: string;
  price: string;
  bonus?: string;
  isMostPopular?: boolean;
  icon?: string;
  description?: string;
}> = {
  'tunematch_credits_5': {
    label: '5 Credits',
    price: '€0.99',
    icon: '🎵',
    description: 'Perfect for trying out',
  },
  'tunematch_credits_18': {
    label: '18 Credits',
    price: '€4.99',
    bonus: '+3 bonus',
    icon: '🎸',
    description: 'Great value',
  },
  'tunematch_credits_60': {
    label: '60 Credits',
    price: '€12.99',
    bonus: '+10 bonus',
    isMostPopular: true,
    icon: '🎹',
    description: 'Best value - Most popular',
  },
  'tunematch_credits_150': {
    label: '150 Credits',
    price: '€24.99',
    bonus: '+30 bonus',
    icon: '🎤',
    description: 'Maximum savings',
  },
};

// Mock packages for when RevenueCat isn't available (Expo Go)
const MOCK_PACKAGES = [
  { id: 'tunematch_credits_5', productId: 'tunematch_credits_5' },
  { id: 'tunematch_credits_18', productId: 'tunematch_credits_18' },
  { id: 'tunematch_credits_60', productId: 'tunematch_credits_60' },
  { id: 'tunematch_credits_150', productId: 'tunematch_credits_150' },
];

type DisplayPackage = {
  id: string;
  productId: string;
  priceString: string;
  isMock?: boolean;
};

const PaymentScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [processingPackage, setProcessingPackage] = useState<string | null>(null);
  const [packages, setPackages] = useState<DisplayPackage[]>([]);
  const [currentCredits, setCurrentCredits] = useState<number>(0);
  const [isUsingMockData, setIsUsingMockData] = useState(false);
  const isAuthenticated = !!user;

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Load user credits - account credits if authenticated, local credits if not
      // Apple Guideline 5.1.1: Allow purchases without registration
      if (isAuthenticated) {
        const credits = await getUserCredits();
        setCurrentCredits(credits);
      } else {
        // Load local credits for non-authenticated users
        const localCredits = await getLocalCredits();
        setCurrentCredits(localCredits);
      }

      // Load available packages from RevenueCat
      const availablePackages = await getAvailablePackages();
      
      if (availablePackages.length > 0) {
        // Real packages from RevenueCat
        const displayPackages: DisplayPackage[] = availablePackages.map(pkg => ({
          id: pkg.identifier,
          productId: pkg.product.identifier,
          priceString: pkg.product.priceString,
          isMock: false,
        }));
        
        // Sort packages by credits amount
        const sortOrder = ['tunematch_credits_5', 'tunematch_credits_18', 'tunematch_credits_60', 'tunematch_credits_150'];
        displayPackages.sort((a, b) => {
          const aIndex = sortOrder.indexOf(a.productId);
          const bIndex = sortOrder.indexOf(b.productId);
          return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
        });
        
        setPackages(displayPackages);
        setIsUsingMockData(false);
      } else {
        // Use mock packages (Expo Go or no products configured)
        const mockDisplayPackages: DisplayPackage[] = MOCK_PACKAGES.map(pkg => ({
          id: pkg.id,
          productId: pkg.productId,
          priceString: PACKAGE_CONFIG[pkg.productId]?.price || '€0.00',
          isMock: true,
        }));
        setPackages(mockDisplayPackages);
        setIsUsingMockData(true);
      }
    } catch (error) {
      console.error('Error loading payment data:', error);
      // Fallback to mock packages on error
      const mockDisplayPackages: DisplayPackage[] = MOCK_PACKAGES.map(pkg => ({
        id: pkg.id,
        productId: pkg.productId,
        priceString: PACKAGE_CONFIG[pkg.productId]?.price || '€0.00',
        isMock: true,
      }));
      setPackages(mockDisplayPackages);
      setIsUsingMockData(true);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const navigateToSignIn = () => {
    // Navigate to sign in screen
    navigation.dispatch(
      CommonActions.navigate({
        name: 'SignIn',
      })
    );
  };

  const handlePurchase = async (pkg: DisplayPackage) => {
    triggerHaptic('medium');
    
    // If using mock data (RevenueCat not available), show error
    // NEVER grant credits without actual payment validation
    if (pkg.isMock) {
      triggerHaptic('error');
      Alert.alert(
        __DEV__ ? 'Development Mode' : 'Store Unavailable',
        __DEV__ 
          ? 'RevenueCat is disabled in development mode. To test purchases:\n\n1. Set SKIP_REVENUECAT_IN_DEV to false in revenuecat.ts\n2. Configure App Store products in RevenueCat\n3. Use a sandbox tester account'
          : 'In-app purchases are temporarily unavailable. Please try again later.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setProcessingPackage(pkg.id);
      
      // Need to get the actual package for purchase
      const availablePackages = await getAvailablePackages();
      const actualPackage = availablePackages.find(p => p.identifier === pkg.id);
      
      if (!actualPackage) {
        Alert.alert('Error', 'Package not found. Please try again.');
        return;
      }
      
      const result = await purchasePackage(actualPackage);
      
      if (result.success && result.transactionId && result.productId) {
        const creditsAmount = getCreditsForProduct(result.productId) || 0;
        
        if (isAuthenticated) {
          // User is authenticated - validate server-side and add to account
          const validation = await validatePurchase(result.transactionId, result.productId);
          
          if (validation.success && validation.creditsGranted) {
            triggerHaptic('success');
            setCurrentCredits(validation.newBalance || currentCredits + validation.creditsGranted);
            Alert.alert(
              '🎉 Purchase Successful!',
              `You received ${validation.creditsGranted} credits!\n\nYour new balance: ${validation.newBalance || currentCredits + validation.creditsGranted} credits`,
              [{ text: 'Awesome!', onPress: () => navigation.goBack() }]
            );
          } else {
            triggerHaptic('error');
            Alert.alert(
              'Purchase Validated',
              'Your purchase was successful, but there was an issue granting credits. Please contact support if credits are not added within a few minutes.',
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
          }
        } else {
          // Apple Guideline 5.1.1: Allow purchases WITHOUT registration
          // Store credits locally on device
          await addLocalCredits(creditsAmount);
          await storeLocalPurchase(result.transactionId, result.productId, creditsAmount);
          
          const newLocalCredits = currentCredits + creditsAmount;
          setCurrentCredits(newLocalCredits);
          
          triggerHaptic('success');
          
          // Offer OPTIONAL registration for cross-device access
          Alert.alert(
            '🎉 Purchase Successful!',
            `You received ${creditsAmount} credits!\n\nYour balance: ${newLocalCredits} credits\n\nWant to access your credits from any device? Sign up for free to enable cross-device sync.`,
            [
              { 
                text: 'Maybe Later', 
                style: 'cancel',
                onPress: () => navigation.goBack()
              },
              { 
                text: 'Sign Up (Free)', 
                onPress: () => {
                  navigation.goBack();
                  setTimeout(() => navigateToSignIn(), 100);
                }
              }
            ]
          );
        }
      } else if (!result.userCancelled) {
        triggerHaptic('error');
        Alert.alert('Purchase Failed', result.error || 'Please try again.');
      }
    } catch (error: any) {
      console.error('Purchase error:', error);
      triggerHaptic('error');
      Alert.alert('Error', 'Unable to complete purchase. Please try again.');
    } finally {
      setProcessingPackage(null);
    }
  };

  const getPackageConfig = (productId: string) => {
    return PACKAGE_CONFIG[productId] || { 
      label: `${getCreditsForProduct(productId)} Credits`, 
      price: '€0.00',
      icon: '🎵',
    };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton 
          icon="arrow-left" 
          size={24} 
          iconColor={Colors.textPrimary}
          onPress={() => {
            triggerHaptic('light');
            navigation.goBack();
          }} 
        />
        <Text variant="titleLarge" style={styles.headerTitle}>Buy Credits</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section - Current Credits */}
        <View style={styles.heroSection}>
          <LinearGradient
            colors={[Colors.accent.blue + '20', Colors.accent.blue + '10', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          >
            <View style={styles.creditsDisplay}>
              <MaterialCommunityIcons 
                name="diamond-stone" 
                size={40} 
                color={Colors.accent.blue} 
              />
              <Text style={styles.creditsValue}>{currentCredits}</Text>
              <Text style={styles.creditsLabel}>Credits Available</Text>
              {!isAuthenticated && currentCredits > 0 && (
                <Text style={styles.creditsHint}>Sign up to sync across devices</Text>
              )}
            </View>
          </LinearGradient>
        </View>

        {/* Packages List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.accent.blue} />
            <Text style={styles.loadingText}>Loading packages...</Text>
          </View>
        ) : (
          <View style={styles.packagesList}>
            {packages.map((pkg, index) => {
              const config = getPackageConfig(pkg.productId);
              const isMostPopular = config.isMostPopular;
              const credits = getCreditsForProduct(pkg.productId);
              
              return (
                <View 
                  key={pkg.id} 
                  style={[
                    styles.packageCard,
                    isMostPopular && styles.popularPackageCard,
                  ]}
                >
                  {isMostPopular && (
                    <View style={styles.popularRibbon}>
                      <LinearGradient
                        colors={[Colors.accent.blue, Colors.accent.blue + 'DD']}
                        style={styles.ribbonGradient}
                      >
                        <MaterialCommunityIcons name="star" size={12} color="#FFF" />
                        <Text style={styles.popularText}>MOST POPULAR</Text>
                      </LinearGradient>
                    </View>
                  )}
                  
                  <View style={styles.packageContent}>
                    <View style={styles.packageMainRow}>
                      {/* Left: Icon & Credits */}
                      <View style={styles.packageLeft}>
                        <Text style={styles.packageIcon}>{config.icon || '🎵'}</Text>
                        <View style={styles.creditsInfo}>
                          <Text style={styles.packageCredits}>{credits}</Text>
                          <Text style={styles.packageCreditsLabel}>Credits</Text>
                          {config.bonus && (
                            <View style={styles.bonusContainer}>
                              <LinearGradient
                                colors={['#4CAF50', '#45A049']}
                                style={styles.bonusGradient}
                              >
                                <MaterialCommunityIcons name="gift" size={12} color="#FFF" />
                                <Text style={styles.bonusText}>{config.bonus}</Text>
                              </LinearGradient>
                            </View>
                          )}
                        </View>
                      </View>

                      {/* Right: Price & Button */}
                      <View style={styles.packageRight}>
                        <Text style={styles.price}>{pkg.priceString}</Text>
                        <Button
                          mode={isMostPopular ? 'contained' : 'outlined'}
                          onPress={() => handlePurchase(pkg)}
                          disabled={processingPackage !== null}
                          loading={processingPackage === pkg.id}
                          style={[
                            styles.purchaseButton,
                            isMostPopular && styles.popularButton,
                          ]}
                          labelStyle={[
                            styles.purchaseButtonLabel,
                            isMostPopular && styles.popularButtonLabel,
                          ]}
                          contentStyle={styles.purchaseButtonContent}
                          compact
                        >
                          {processingPackage === pkg.id ? 'Processing...' : 'Buy Now'}
                        </Button>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Compact Info Section */}
        <View style={styles.infoSection}>
          <MaterialCommunityIcons name="check-circle" size={14} color={Colors.accent.blue} />
          <Text style={styles.infoText}>1 credit = 1 analysis • In-app purchase only • Credits never expire</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '700',
    color: Colors.textPrimary,
    fontSize: 18,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  
  // Hero Section
  heroSection: {
    marginBottom: Spacing.lg,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  heroGradient: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  creditsDisplay: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  creditsValue: {
    fontSize: 48,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: Spacing.xs,
    letterSpacing: -1,
  },
  creditsLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  creditsHint: {
    fontSize: 11,
    color: Colors.accent.blue,
    marginTop: 6,
    fontWeight: '500',
  },

  // Packages List - Compact Vertical
  packagesList: {
    flexDirection: 'column',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  packageCard: {
    width: '100%',
    backgroundColor: Colors.cardBackground,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    ...Shadows.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  popularPackageCard: {
    borderWidth: 2,
    borderColor: Colors.accent.blue,
    ...Shadows.prominent,
  },
  popularRibbon: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 10,
    borderTopRightRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  ribbonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 3,
    gap: 3,
  },
  popularText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  packageContent: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 10,
  },
  packageMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  packageLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.md,
  },
  packageRight: {
    alignItems: 'flex-end',
    gap: Spacing.sm,
    minWidth: 95,
  },
  packageIcon: {
    fontSize: 32,
  },
  creditsInfo: {
    flex: 1,
    gap: 4,
  },
  packageCredits: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    lineHeight: 28,
  },
  packageCreditsLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginTop: 2,
  },
  bonusContainer: {
    borderRadius: BorderRadius.round,
    overflow: 'hidden',
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  bonusGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    gap: 4,
  },
  bonusText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
  },
  price: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.accent.blue,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  purchaseButton: {
    borderRadius: BorderRadius.md,
    height: 32,
    borderWidth: 0,
    borderColor: Colors.accent.blue,
    minWidth: 85,
    backgroundColor: Colors.accent.blue,
  },
  popularButton: {
    backgroundColor: Colors.accent.blue,
    borderColor: Colors.accent.blue,
  },
  purchaseButtonContent: {
    height: 32,
    paddingHorizontal: Spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  purchaseButtonLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFF',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    marginTop: 4,
  },
  popularButtonLabel: {
    color: '#FFF',
  },

  // Info Section
  infoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  infoText: {
    fontSize: 10,
    color: Colors.textSecondary,
    flex: 1,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
  },
  loadingText: {
    marginTop: Spacing.sm,
    color: Colors.textSecondary,
    fontSize: 12,
  },
});

export default PaymentScreen;
