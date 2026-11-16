import { createContext, useContext } from 'react';
import { safeStorage } from '@/lib/safeStorage';

export type ViewMode = 'globe' | 'grid' | 'matrix' | 'table' | 'uptime';

/** Display order of the views (header switcher, settings). */
export const VIEW_MODES: readonly ViewMode[] = ['globe', 'matrix', 'grid', 'table', 'uptime'];

/** Warm Vite async chunks when user hovers a view they might switch to */
export function prefetchDashboardView(mode: ViewMode) {
  switch (mode) {
    case 'globe':
      void import('@/components/GlobeView');
      break;
    case 'uptime':
      void import('@/components/UptimeView');
      break;
    case 'grid':
    case 'table':
      void import('@/components/NodeList');
      break;
    case 'matrix':
      void import('@/components/NodeList');
      void import('@/matrix/MatrixGrid');
      break;
    default:
      break;
  }
}

export function getInitialViewMode(): ViewMode {
  const saved = safeStorage.get('nodeViewMode');
  if (saved && (VIEW_MODES as readonly string[]).includes(saved)) return saved as ViewMode;
  return 'globe';
}

export interface ViewModeContextType {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export const ViewModeContext = createContext<ViewModeContextType>({
  viewMode: 'globe',
  setViewMode: () => {},
});

export function useViewMode() {
  return useContext(ViewModeContext);
}
