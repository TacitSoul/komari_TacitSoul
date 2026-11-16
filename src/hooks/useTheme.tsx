import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/** Visual themes that map to actual CSS styling */
export type VisualTheme = 'clean' | 'deepspace';

/** Selectable preference: a visual theme, or "auto" which follows the OS colour scheme. */
export type Theme = VisualTheme | 'auto';

/** Value persisted under Komari's shared `appearance` key (also read by the built-in admin UI). */
type StoredAppearance = 'light' | 'dark' | 'system';

interface ThemeContextType {
  /** Effective preference (may be "auto"). */
  theme: Theme;
  /** The actually-applied visual theme (never "auto"). */
  resolvedTheme: VisualTheme;
  /** Explicit visitor choice — persisted. */
  setTheme: (theme: Theme) => void;
  /** Admin default — used only while the visitor has made no explicit choice. */
  setDefaultTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'appearance';
const DEFAULT_CACHE_KEY = 'tacitsoul:default-theme';

const TO_STORED: Record<Theme, StoredAppearance> = { clean: 'light', deepspace: 'dark', auto: 'system' };

/** Map anything found in storage (Komari's values, or the base theme's legacy palette names) to a preference. */
export function parseStoredTheme(raw: string | null | undefined): Theme | null {
  if (!raw) return null;
  const value = raw.replace(/^"|"$/g, '').trim().toLowerCase();
  if (value === 'light' || value === 'clean') return 'clean';
  if (value === 'dark' || value === 'deepspace') return 'deepspace';
  if (value === 'system' || value === 'auto') return 'auto';
  return null;
}

function readStored(key: string): Theme | null {
  try {
    return parseStoredTheme(localStorage.getItem(key));
  } catch {
    return null;
  }
}

/**
 * Appearance that is *already applied* to <html>.
 *
 * Canvas-drawn widgets read CSS variables at draw time. React runs child effects before the
 * provider's, so a component that redraws on `resolvedTheme` would sample the previous palette.
 * This store flips only after the attributes are on the root element, which makes it the safe
 * redraw trigger.
 */
export type AppliedAppearance = 'light' | 'dark';

let appliedAppearance: AppliedAppearance =
  typeof document !== 'undefined' && document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'light';
const appearanceListeners = new Set<() => void>();

function publishAppliedAppearance(next: AppliedAppearance) {
  if (next === appliedAppearance) return;
  appliedAppearance = next;
  appearanceListeners.forEach((listener) => listener());
}

function subscribeAppliedAppearance(listener: () => void) {
  appearanceListeners.add(listener);
  return () => {
    appearanceListeners.delete(listener);
  };
}

const getAppliedAppearance = () => appliedAppearance;

export function useAppliedAppearance(): AppliedAppearance {
  return useSyncExternalStore(subscribeAppliedAppearance, getAppliedAppearance, getAppliedAppearance);
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [explicitTheme, setExplicitTheme] = useState<Theme | null>(() => readStored(STORAGE_KEY));
  const [defaultTheme, setDefaultThemeState] = useState<Theme>(() => readStored(DEFAULT_CACHE_KEY) ?? 'clean');
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  const theme: Theme = explicitTheme ?? defaultTheme;

  // Listen for system colour-scheme changes (only relevant when theme === 'auto')
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedTheme: VisualTheme = useMemo(() => {
    if (theme === 'auto') return systemDark ? 'deepspace' : 'clean';
    return theme;
  }, [theme, systemDark]);

  const setTheme = useCallback((next: Theme) => {
    setExplicitTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, TO_STORED[next]);
    } catch {
      // localStorage not available
    }
  }, []);

  const setDefaultTheme = useCallback((next: Theme) => {
    setDefaultThemeState(next);
    try {
      localStorage.setItem(DEFAULT_CACHE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  // Layout effect: the palette is on <html> before the first paint (no flash of the base palette).
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolvedTheme);
    // `data-appearance` is what the matrix styles and canvas colour cache key on.
    root.setAttribute('data-appearance', resolvedTheme === 'deepspace' ? 'dark' : 'light');
    root.classList.toggle('dark', resolvedTheme === 'deepspace');
    root.style.colorScheme = resolvedTheme === 'deepspace' ? 'dark' : 'light';

    // Sync <meta name="theme-color"> so the PWA standalone-mode status bar
    // tracks the active theme. Values mirror the --background tokens in index.css.
    const themeColor = resolvedTheme === 'deepspace' ? '#0a0e1a' : '#fcfcfd';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', themeColor);

    publishAppliedAppearance(resolvedTheme === 'deepspace' ? 'dark' : 'light');
  }, [resolvedTheme]);

  // Toggle a root attribute when the page is hidden so a global CSS rule
  // can pause all decorative animations.
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (document.hidden) {
        root.setAttribute('data-page-hidden', '');
      } else {
        root.removeAttribute('data-page-hidden');
      }
    };
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => document.removeEventListener('visibilitychange', apply);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, setDefaultTheme }),
    [theme, resolvedTheme, setTheme, setDefaultTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
