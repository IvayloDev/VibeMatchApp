import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EventSubscription } from 'expo-modules-core';
import { trackEvent } from './posthog';

/**
 * Local notifications (no backend / push tokens / cron).
 *
 * Two independent things are scheduled here:
 *
 *   1. The re-engagement LADDER - an inactivity timer. Every app foreground
 *      and every successful match cancels + re-arms it, so an active user is
 *      never pestered; only a multi-day gap lets the first nudge fire.
 *      Cadence: +3 days, then ~weekly (+10, +17, +24).
 *
 *   2. The FREE-MATCH reminder - a single notification, set from the
 *      out-of-matches wall, that fires when tomorrow's free match unlocks.
 *      Re-arming the ladder must NOT cancel it, which is why every scheduled
 *      identifier is tracked here instead of using cancelAll.
 */

// Only records an explicit denial that the OS will not let us re-ask about.
// It used to record "we asked once" and, because SecureStore survives a
// reinstall on iOS while the OS permission does not, a reinstalled app never
// asked again - so nobody ever got a notification.
const PERM_DENIED_KEY = 'tunematch_notif_perm_requested';
const LADDER_IDS_KEY = '@tunematch_notif_ladder_ids';
const FREE_MATCH_ID_KEY = '@tunematch_notif_free_match_id';
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
    body: 'Your camera roll has a soundtrack. Find today\'s vibe.',
  },
  {
    offsetDays: 10,
    title: 'TuneMatch',
    body: 'New photos? New playlist. Match a vibe in seconds.',
  },
  {
    offsetDays: 17,
    title: 'TuneMatch',
    body: 'Miss the music? Turn a moment into a song.',
  },
  {
    offsetDays: 24,
    title: 'TuneMatch',
    body: 'That sunset deserves a soundtrack. Open TuneMatch.',
  },
];

function androidTriggerExtras() {
  return Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {};
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function readIdList(key: string): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(key);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function cancelIds(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}))
  );
}

/**
 * Ask for notification permission whenever the OS still allows asking.
 * Returns whether notifications are currently granted. Never throws.
 *
 * `source` names the moment we asked (post_match, wall_sheet, profile_test)
 * so the grant rate can be compared per prompt.
 */
export async function ensureNotificationPermission(source: string = 'post_match'): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;

    await ensureAndroidChannel();

    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;

    const askable = current.status === 'undetermined' || current.canAskAgain;
    if (!askable) {
      // Explicit denial the OS will not re-prompt for. Remember it so we stop
      // calling the OS for nothing; only Settings can flip this now.
      const alreadyDenied = (await SecureStore.getItemAsync(PERM_DENIED_KEY)) === 'true';
      if (!alreadyDenied) {
        await SecureStore.setItemAsync(PERM_DENIED_KEY, 'true');
        trackEvent('notification_permission', {
          granted: false,
          status: current.status,
          source,
          asked: false,
        });
      }
      return false;
    }

    const req = await Notifications.requestPermissionsAsync();
    trackEvent('notification_permission', {
      granted: req.granted,
      status: req.status,
      source,
      asked: true,
    });
    if (req.granted) {
      await SecureStore.deleteItemAsync(PERM_DENIED_KEY).catch(() => {});
    } else if (!req.canAskAgain) {
      await SecureStore.setItemAsync(PERM_DENIED_KEY, 'true');
    }
    return req.granted;
  } catch (err) {
    console.warn('[notifications] ensureNotificationPermission failed:', err);
    return false;
  }
}

/**
 * Cancel the ladder's own reminders and re-arm the full gentle ladder from
 * "now". Leaves the free-match reminder alone. No-op if permission isn't
 * granted. Never throws.
 */
export async function rescheduleEngagementReminders(): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;

    await ensureAndroidChannel();

    const previousIds = await readIdList(LADDER_IDS_KEY);
    const freeMatchId = await AsyncStorage.getItem(FREE_MATCH_ID_KEY);
    if (previousIds.length === 0 && !freeMatchId) {
      // First run of a build that tracks identifiers: nothing of ours can be
      // pending except reminders an older build scheduled, so clear them all.
      await Notifications.cancelAllScheduledNotificationsAsync();
    } else {
      await cancelIds(previousIds);
    }

    // DEV-only fast mode: interpret offsetDays as *seconds* (x15) so the
    // ladder fires at ~15/50/85/120s instead of days. Auto-reverts to real
    // days in production (__DEV__ === false). Background the app to see them.
    const unitMs = __DEV__ ? 15 * 1000 : DAY_MS;

    const now = Date.now();
    const ids: string[] = [];
    let firstAt: Date | null = null;
    for (const r of REMINDERS) {
      const date = new Date(now + r.offsetDays * unitMs);
      if (!firstAt) firstAt = date;
      const id = await Notifications.scheduleNotificationAsync({
        content: { title: r.title, body: r.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date,
          ...androidTriggerExtras(),
        },
      });
      ids.push(id);
    }
    await AsyncStorage.setItem(LADDER_IDS_KEY, JSON.stringify(ids));

    // The ladder re-arms on every foreground; only the first arm is worth an
    // event, otherwise this fires on every app open.
    if (previousIds.length === 0) {
      trackEvent('notifications_scheduled', {
        kind: 'ladder',
        next_at: firstAt ? firstAt.toISOString() : null,
      });
    }
    console.log(
      `[notifications] reminders rescheduled (${__DEV__ ? 'DEV ~15/50/85/120s' : '+3/+10/+17/+24d'})`
    );
  } catch (err) {
    console.warn('[notifications] rescheduleEngagementReminders failed:', err);
  }
}

/**
 * Safety net from when the reset was at midnight. The match day now rolls
 * over at 09:00 local, so this normally does nothing.
 */
function toWakingHours(at: Date): Date {
  if (at.getHours() < 7) {
    const moved = new Date(at);
    moved.setHours(8, 0, 0, 0);
    return moved;
  }
  return at;
}

/**
 * Schedule ONE "your free match is ready" notification for `at` (asks for
 * permission first, from the wall sheet). Replaces any earlier free-match
 * reminder. Returns whether it was scheduled. Never throws.
 */
export async function scheduleFreeMatchReminder(at: Date): Promise<boolean> {
  return scheduleFreeMatch(at, { ask: true });
}

/**
 * Same reminder, but only for people who have already allowed notifications.
 * Called whenever the balance reaches zero, so the daily ping arrives without
 * anyone having to opt in twice - and without a permission sheet appearing
 * out of nowhere on the Dashboard.
 */
export async function scheduleFreeMatchReminderIfAllowed(at: Date): Promise<boolean> {
  return scheduleFreeMatch(at, { ask: false });
}

async function scheduleFreeMatch(at: Date, { ask }: { ask: boolean }): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;

    if (ask) {
      const granted = await ensureNotificationPermission('wall_sheet');
      if (!granted) return false;
    } else {
      const { granted } = await Notifications.getPermissionsAsync();
      if (!granted) return false;
    }

    let fireAt = toWakingHours(at);
    if (fireAt.getTime() <= Date.now()) {
      // Already unlocked - still worth a nudge, just not an instant one.
      fireAt = new Date(Date.now() + 60 * 1000);
    }

    const previousId = await AsyncStorage.getItem(FREE_MATCH_ID_KEY);
    if (previousId) await cancelIds([previousId]);

    const id = await Notifications.scheduleNotificationAsync({
      content: { title: 'TuneMatch', body: 'Your free match is ready. Pick a photo.' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        ...androidTriggerExtras(),
      },
    });
    await AsyncStorage.setItem(FREE_MATCH_ID_KEY, id);

    trackEvent('notifications_scheduled', { kind: 'free_match', next_at: fireAt.toISOString() });
    console.log(`[notifications] free-match reminder set for ${fireAt.toISOString()}`);
    return true;
  } catch (err) {
    console.warn('[notifications] scheduleFreeMatchReminder failed:', err);
    return false;
  }
}

/**
 * Fires a test notification 10 seconds from now (hidden Profile action).
 * Background the app to see it as a banner. Returns false if permission is
 * missing. Never throws.
 */
export async function sendTestNotification(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;
    const granted = await ensureNotificationPermission('profile_test');
    if (!granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: { title: 'TuneMatch', body: 'Test notification from TuneMatch' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 10,
        ...androidTriggerExtras(),
      },
    });
    return true;
  } catch (err) {
    console.warn('[notifications] sendTestNotification failed:', err);
    return false;
  }
}

let openedSubscription: EventSubscription | null = null;
let lastTrackedResponseKey: string | null = null;

function trackOpened(response: Notifications.NotificationResponse | null | undefined): void {
  const request = response?.notification?.request;
  if (!request) return;
  // The launching response can reach us twice (last-response read + listener).
  const key = `${request.identifier}:${response?.notification?.date ?? ''}`;
  if (key === lastTrackedResponseKey) return;
  lastTrackedResponseKey = key;
  trackEvent('notification_opened', {
    body: request.content?.body ?? null,
    title: request.content?.title ?? null,
  });
}

/**
 * Track every notification tap as `notification_opened { body }`. Call once
 * at app start (DashboardScreen mount); returns an unsubscribe. Also picks up
 * the notification that cold-launched the app, which the listener alone can
 * miss.
 */
export function registerNotificationOpenedTracking(): () => void {
  if (openedSubscription) return () => {};
  try {
    openedSubscription = Notifications.addNotificationResponseReceivedListener(trackOpened);
  } catch (err) {
    console.warn('[notifications] response listener unavailable:', err);
    return () => {};
  }
  try {
    trackOpened(Notifications.getLastNotificationResponse());
  } catch {
    // Not available on every platform - the listener still covers warm taps.
  }
  return () => {
    openedSubscription?.remove();
    openedSubscription = null;
  };
}
