/**
 * Hook for provider theme - now a no-op since we use CSS defaults.
 * Each deployment shows its own runtime badge instead of global theming.
 */
export function useProviderTheme() {
  // No longer override CSS variables - use the default blue theme from index.css
  return { providerId: 'neutral' as const }
}
