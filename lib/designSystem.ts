// Design System inspired by modern dark theme with floating cards
// Based on the beautiful Figma design provided

export const Colors = {
  // Primary Background - Deep black like the design
  background: '#000000',
  backgroundSecondary: '#111111',
  
  // Card backgrounds - Dark gray with slight transparency
  cardBackground: '#1C1C1E',
  cardBackgroundSecondary: '#2C2C2E',
  
  // Text colors
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#666666',
  
  // Accent colors inspired by the design
  accent: {
    red: '#FF6B6B',     // For "People" - warm red
    blue: '#4DABF7',    // For "Places" - cool blue  
    yellow: '#FFD93D',  // For "Memories" - warm yellow
    coral: '#FF8A80',   // For "Pictures" - coral/pink
    green: '#51CF66',   // For maps/location
  },
  
  // Button colors
  buttonPrimary: '#FFFFFF',
  buttonPrimaryText: '#000000',
  buttonSecondary: 'rgba(255, 255, 255, 0.1)',
  buttonSecondaryText: '#FFFFFF',
  
  // Status colors
  success: '#30D158',
  warning: '#FF9F0A',
  error: '#FF453A',
  
  // Border and separator colors
  border: 'rgba(255, 255, 255, 0.1)',
  separator: 'rgba(255, 255, 255, 0.05)',
};

export const Typography = {
  // Large display text - like "They are People, Places..."
  display: {
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 38,
    color: Colors.textPrimary,
  },
  
  // Main headings
  heading1: {
    fontSize: 28,
    fontWeight: '600' as const,
    lineHeight: 34,
    color: Colors.textPrimary,
  },
  
  // Section headings
  heading2: {
    fontSize: 22,
    fontWeight: '600' as const,
    lineHeight: 28,
    color: Colors.textPrimary,
  },
  
  // Card titles
  heading3: {
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
    color: Colors.textPrimary,
  },
  
  // Body text
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
    color: Colors.textSecondary,
  },
  
  // Small text
  caption: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 18,
    color: Colors.textTertiary,
  },
  
  // Button text
  button: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 20,
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  round: 50,
};

export const Shadows = {
  // Subtle shadow for floating cards
  card: {
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  
  // Stronger shadow for important elements
  prominent: {
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
};

export const Layout = {
  // Screen padding
  screenPadding: Spacing.lg,
  
  // Card spacing
  cardSpacing: Spacing.md,
  
  // Button heights
  buttonHeight: 52,
  buttonHeightSmall: 44,
  
  // Input heights
  inputHeight: 52,
};

// Helper function to create gradient text styles (for colored text like in the design)
export const createGradientTextStyle = (color: string) => ({
  color,
  fontWeight: '700' as const,
});

// Helper function to create floating card style
export const createFloatingCardStyle = (backgroundColor = Colors.cardBackground) => ({
  backgroundColor,
  borderRadius: BorderRadius.lg,
  padding: Spacing.lg,
  ...Shadows.card,
});

// Helper function to create button styles
export const createButtonStyle = (variant: 'primary' | 'secondary' = 'primary') => ({
  backgroundColor: variant === 'primary' ? Colors.buttonPrimary : Colors.buttonSecondary,
  borderRadius: BorderRadius.xl,
  height: Layout.buttonHeight,
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  ...Shadows.card,
});
