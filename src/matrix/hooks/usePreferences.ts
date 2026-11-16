import { useAppliedAppearance } from "@/hooks/useTheme";

/**
 * Appearance for canvas redraw keys. It is the appearance already applied to <html>, so a
 * canvas that redraws on change samples the new palette, never the previous one.
 */
export function usePreferences() {
  return { resolvedAppearance: useAppliedAppearance() };
}
