import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local match history for guests.
 *
 * The `history` table insert in AnalyzingScreen is gated on a Supabase user id,
 * so a guest's match was shown once and then lost the moment they left the
 * results screen - their Vault stayed empty forever. Guests are the majority of
 * users, so that removed the only reason to reopen the app. This mirrors the
 * same shape locally; HistoryScreen merges the two sources.
 */

const STORAGE_KEY = '@tunematch/guest_history';

// Keep the list bounded - this is a convenience cache, not an archive.
const MAX_ITEMS = 50;

// Prefix marks an id as local so delete paths don't send it to Supabase.
export const GUEST_HISTORY_ID_PREFIX = 'local:';

export type GuestHistoryItem = {
  id: string;
  image_url: string;
  songs: any[];
  created_at: string;
};

export function isGuestHistoryId(id?: string | null): boolean {
  return !!id && id.startsWith(GUEST_HISTORY_ID_PREFIX);
}

export async function loadGuestHistory(): Promise<GuestHistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addGuestHistoryItem(
  imageUrl: string,
  songs: any[]
): Promise<GuestHistoryItem | null> {
  try {
    if (!imageUrl || !songs?.length) return null;

    const item: GuestHistoryItem = {
      id: `${GUEST_HISTORY_ID_PREFIX}${Date.now()}`,
      image_url: imageUrl,
      songs,
      created_at: new Date().toISOString(),
    };

    const existing = await loadGuestHistory();
    const next = [item, ...existing].slice(0, MAX_ITEMS);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return item;
  } catch (error) {
    // Never let a cache write break the match flow.
    console.error('Error saving guest history item:', error);
    return null;
  }
}

export async function removeGuestHistoryItem(id: string): Promise<void> {
  try {
    const existing = await loadGuestHistory();
    const next = existing.filter(item => item.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.error('Error removing guest history item:', error);
  }
}
