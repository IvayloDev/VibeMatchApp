export type Vibe = {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  gradient: [string, string];
};

export const VIBES: Vibe[] = [
  {
    id: 'hype',
    name: 'Hype',
    subtitle: 'Party · Workout · Going out',
    icon: 'fire',
    gradient: ['#FF6B35', '#F4258C'],
  },
  {
    id: 'chill',
    name: 'Chill',
    subtitle: 'Relaxed · Hangouts · Coffee',
    icon: 'leaf',
    gradient: ['#4FC3F7', '#1DE9B6'],
  },
  {
    id: 'romantic',
    name: 'Romantic',
    subtitle: 'Sunsets · Soft · Intimate',
    icon: 'heart',
    gradient: ['#F4258C', '#FF8A80'],
  },
  {
    id: 'moody',
    name: 'Moody',
    subtitle: 'Night · Deep · Introspective',
    icon: 'weather-night',
    gradient: ['#673AB7', '#1A1A2E'],
  },
];

export const getVibeById = (id: string | null | undefined): Vibe | undefined =>
  id ? VIBES.find(v => v.id === id) : undefined;
