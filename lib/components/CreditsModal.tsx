import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

// Brand palette (matches the onboarding / results screens).
const C = {
  card: '#1B0E17',
  primary: '#f4258c',
  purple: '#8b5cf6',
  white: '#FFFFFF',
  dim: 'rgba(255,255,255,0.60)',
  border: 'rgba(255,255,255,0.10)',
};

type CreditsModalProps = {
  visible: boolean;
  onCancel: () => void;
  onBuy: () => void;
  title?: string;
  message?: string;
  buyLabel?: string;
  cancelLabel?: string;
};

/**
 * Branded replacement for the native "No Credits Available" alert.
 * Tapping the backdrop or "Not now" calls onCancel; the primary button calls onBuy.
 */
export default function CreditsModal({
  visible,
  onCancel,
  onBuy,
  title = "You're out of credits",
  message = 'You need at least 1 credit to match a photo. Grab a few more to keep discovering songs.',
  buyLabel = 'Get Credits',
  cancelLabel = 'Not now',
}: CreditsModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* Stop taps on the card from closing the modal */}
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="music-note-eighth" size={30} color={C.primary} />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <TouchableOpacity activeOpacity={0.85} onPress={onBuy} style={styles.buyBtn}>
            <LinearGradient
              colors={[C.primary, C.purple]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.buyGradient}
            >
              <MaterialCommunityIcons name="lightning-bolt" size={18} color="#FFF" />
              <Text style={styles.buyText}>{buyLabel}</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={onCancel} style={styles.cancelBtn} activeOpacity={0.7}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    alignItems: 'center',
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(244,37,140,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: C.white,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    color: C.dim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },
  buyBtn: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  buyGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
  },
  buyText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    paddingVertical: 14,
    marginTop: 4,
  },
  cancelText: {
    color: C.dim,
    fontSize: 15,
    fontWeight: '600',
  },
});
