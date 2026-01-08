import React from 'react';
import { View, StyleSheet, Modal, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../designSystem';
import { LinearGradientFallback as LinearGradient } from './LinearGradientFallback';
import { BlurViewFallback as BlurView } from './BlurViewFallback';
import { ModernButton } from './ModernButton';
import { GUEST_FREE_CREDITS, REGISTERED_FREE_CREDITS } from '../utils/freeCredits';

interface GuestCreditsModalProps {
  visible: boolean;
  onContinue: () => void;
  onSignUp: () => void;
}

export const GuestCreditsModal: React.FC<GuestCreditsModalProps> = ({
  visible,
  onContinue,
  onSignUp,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onContinue}
    >
      <Pressable 
        style={styles.overlay}
        onPress={onContinue}
      >
        <Pressable 
          style={styles.modalContainer}
          onPress={(e) => e.stopPropagation()}
        >
          <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
            <LinearGradient
              colors={[Colors.accent.blue + '40', Colors.accent.coral + '30', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradient}
            >
              <View style={styles.content}>
                {/* Icon */}
                <View style={styles.iconContainer}>
                  <MaterialCommunityIcons 
                    name="diamond-stone" 
                    size={48} 
                    color={Colors.accent.blue} 
                  />
                </View>

                {/* Title */}
                <Text style={styles.title}>Free Credits Available!</Text>

                {/* Guest Info */}
                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <MaterialCommunityIcons 
                      name="account-outline" 
                      size={20} 
                      color={Colors.textSecondary} 
                    />
                    <Text style={styles.infoText}>
                      <Text style={styles.highlight}>Continue as Guest:</Text> Get {GUEST_FREE_CREDITS} free credit
                    </Text>
                  </View>
                </View>

                {/* Registered Info */}
                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <MaterialCommunityIcons 
                      name="account-check" 
                      size={20} 
                      color={Colors.accent.green} 
                    />
                    <Text style={styles.infoText}>
                      <Text style={styles.highlight}>Create Account:</Text> Get {REGISTERED_FREE_CREDITS} free credits
                    </Text>
                  </View>
                </View>

                {/* Note */}
                <View style={styles.noteContainer}>
                  <MaterialCommunityIcons 
                    name="information" 
                    size={16} 
                    color={Colors.accent.yellow} 
                  />
                  <Text style={styles.noteText}>
                    Free credits are one-time only per device/account
                  </Text>
                </View>

                {/* Buttons */}
                <View style={styles.buttonContainer}>
                  <ModernButton
                    title="Create Account"
                    onPress={onSignUp}
                    variant="primary"
                    style={styles.signUpButton}
                  />
                  <ModernButton
                    title="Continue as Guest"
                    onPress={onContinue}
                    variant="secondary"
                    style={styles.continueButton}
                  />
                </View>
              </View>
            </LinearGradient>
          </BlurView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
  },
  blurContainer: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    ...Shadows.prominent,
  },
  gradient: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
  },
  content: {
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: Spacing.md,
  },
  title: {
    ...Typography.heading2,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  infoCard: {
    width: '100%',
    backgroundColor: Colors.cardBackgroundSecondary + '60',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border + '40',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  infoText: {
    ...Typography.body,
    color: Colors.textSecondary,
    flex: 1,
    fontSize: 15,
  },
  highlight: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  noteText: {
    ...Typography.caption,
    color: Colors.accent.yellow,
    fontSize: 12,
    flex: 1,
  },
  buttonContainer: {
    width: '100%',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  signUpButton: {
    width: '100%',
  },
  continueButton: {
    width: '100%',
  },
});

