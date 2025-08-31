import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getUserCredits } from '../../../lib/credits';
import { Colors, Typography, Spacing, Layout, BorderRadius } from '../../../lib/designSystem';
import { FloatingCard } from '../../../lib/components/FloatingCard';
import { ModernButton } from '../../../lib/components/ModernButton';

type RootStackParamList = {
  RecommendationType: { image: string };
  Payment: undefined;
  // ...other routes
};

const DashboardScreen = () => {
  const userName = 'User';
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

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

  // Load credits on mount
  useEffect(() => {
    loadUserCredits();
  }, []);

  // Refresh credits when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadUserCredits();
    }, [])
  );

  const pickImage = async () => {
    // Check if user has enough credits before allowing image selection
    if (credits < 1) {
      Alert.alert(
        'No Credits Available',
        'You need at least 1 credit to analyze a photo. Would you like to purchase more credits?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Buy Credits', onPress: () => navigation.navigate('Payment') }
        ]
      );
      return;
    }

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
      navigation.navigate('RecommendationType', { image: manipResult.uri });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.topRow}>
            <Text style={styles.welcomeText}>
              Welcome back 👋
            </Text>
            <View style={styles.creditsDisplay}>
              <Text style={styles.creditsValue}>
                {loading ? '•••' : credits}
              </Text>
              <Text style={styles.creditsLabel}>Credits</Text>
            </View>
          </View>
          {credits < 1 && !loading && (
            <View style={styles.lowCreditsAlert}>
              <Text style={styles.lowCreditsText}>
                🔋 Low credits - get more to continue analyzing
              </Text>
            </View>
          )}
        </View>

        {/* Main Feature Card */}
        <View style={styles.featuresSection}>
          <Text style={styles.sectionTitle}>What would you like to discover?</Text>
          
          <FloatingCard style={styles.mainFeatureCard}>
            <Text style={styles.featureEmoji}>📸</Text>
            <Text style={styles.featureTitle}>Mood Matching</Text>
            <Text style={styles.featureSubtitle}>
              Find songs that perfectly match your current vibe
            </Text>
            <View style={styles.costBadge}>
              <Text style={styles.costText}>1 Credit = 3 Songs</Text>
            </View>
            
            <ModernButton
              title="Analyze Photo"
              onPress={pickImage}
              disabled={credits < 1}
              variant={credits < 1 ? "secondary" : "primary"}
              style={styles.analyzeButton}
            />
          </FloatingCard>
        </View>

        {/* Buy Credits Section - Only show when no credits */}
        {credits < 1 && !loading && (
          <View style={styles.buyCreditsSection}>
            <ModernButton
              title="💳 Get More Credits"
              onPress={() => navigation.navigate('Payment')}
              variant="secondary"
              style={styles.buyCreditsButton}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  header: {
    marginBottom: Spacing.lg,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  welcomeText: {
    ...Typography.heading2,
    flex: 1,
    marginRight: Spacing.md,
  },
  creditsDisplay: {
    alignItems: 'center',
    backgroundColor: Colors.cardBackground,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    minWidth: 80,
  },
  creditsValue: {
    ...Typography.heading3,
    color: Colors.accent.green,
    fontWeight: '700',
    fontSize: 20,
  },
  creditsLabel: {
    ...Typography.caption,
    fontSize: 11,
    marginTop: 2,
  },
  lowCreditsAlert: {
    backgroundColor: Colors.accent.yellow + '20',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent.yellow,
  },
  lowCreditsText: {
    ...Typography.caption,
    color: Colors.accent.yellow,
    textAlign: 'center',
  },
  featuresSection: {
    flex: 1,
    justifyContent: 'center',
  },
  sectionTitle: {
    ...Typography.heading2,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  mainFeatureCard: {
    alignItems: 'center',
    position: 'relative',
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  featureEmoji: {
    fontSize: 48,
    marginBottom: Spacing.md,
  },
  featureTitle: {
    ...Typography.heading3,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  featureSubtitle: {
    ...Typography.body,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  costBadge: {
    backgroundColor: Colors.accent.green,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
  },
  costText: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: '600',
    fontSize: 12,
  },
  comingSoonBadge: {
    backgroundColor: Colors.accent.yellow,
  },
  comingSoonText: {
    ...Typography.caption,
    color: Colors.background,
    fontWeight: '600',
    fontSize: 12,
  },
  analyzeButton: {
    marginTop: Spacing.lg,
    width: '100%',
  },
  buyCreditsSection: {
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  buyCreditsButton: {
    width: '100%',
  },
});

export default DashboardScreen; 