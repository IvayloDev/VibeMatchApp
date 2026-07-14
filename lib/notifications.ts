import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';

/**
 * Local re-engagement notifications (no backend / push tokens / cron).
 *
 * The schedule acts as an INACTIVITY TIMER: every app foreground and every
 * successful match cancels + reschedules all reminders, so an active user
 * never gets pestered — only a multi-day gap lets the first nudge fire.
 *
 * Cadence (gentle): first touch at +3 days inactive, then ~weekly
 * (+10, +17, +24 days). All four are re-armed on each app open.
 */

const PERM_REQUESTED_KEY = 'tunematch_notif_perm_requested';
const ANDROID_CHANNEL_ID = 'reminders';
const DAY_MS = 24 * 60 * 60 * 1000;

// Foreground behaviour: still surface the alert + sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const REMINDERS: { offsetDays: number; title: string; body: string }[] = [
  {
    offsetDays: 3,
    title: 'TuneMatch',
    body: 'Your camera roll has a soundtrack 🎵 Find today’s vibe.',
  },
  {
    offsetDays: 10,
    title: 'TuneMatch',
    body: 'New photos? New playlist. Match a vibe in seconds.',
  },
  {
    offsetDays: 17,
    title: 'TuneMatch',
    body: 'Miss the music? Turn a moment into a song 🎧',
  },
  {
    offsetDays: 24,
    title: 'TuneMatch',
    body: 'That sunset deserves a soundtrack. Open TuneMatch.',
  },
];

/**
 * Ask for notification permission ONCE (value-first — call this only after
 * the user's first successful match, not on cold launch). Returns whether
 * notifications are currently granted. Never throws.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;

    // Only surface the OS dialog once ever.
    const alreadyAsked = await SecureStore.getItemAsync(PERM_REQUESTED_KEY);
    if (alreadyAsked === 'true') return false;

    await SecureStore.setItemAsync(PERM_REQUESTED_KEY, 'true');
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch (err) {
    console.warn('[notifications] ensureNotificationPermission failed:', err);
    return false;
  }
}

/**
 * Cancel all scheduled reminders and re-arm the full gentle ladder from
 * "now". No-op if permission isn't granted. Never throws.
 */
export async function rescheduleEngagementReminders(): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;

    await Notifications.cancelAllScheduledNotificationsAsync();

    // DEV-only fast mode: interpret offsetDays as *seconds* (×15) so the
    // ladder fires at ~15/50/85/120s instead of days. Auto-reverts to real
    // days in production (__DEV__ === false). Background the app to see them.
    const unitMs = __DEV__ ? 15 * 1000 : DAY_MS;

    const now = Date.now();
    for (const r of REMINDERS) {
      const date = new Date(now + r.offsetDays * unitMs);
      await Notifications.scheduleNotificationAsync({
        content: { title: r.title, body: r.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date,
          ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
      });
    }
    console.log(
      `[notifications] reminders rescheduled (${__DEV__ ? 'DEV ~15/50/85/120s' : '+3/+10/+17/+24d'})`
    );
  } catch (err) {
    console.warn('[notifications] rescheduleEngagementReminders failed:', err);
  }
}
