/**
 * Frame budget of the 3D earth. The base theme capped its globe's auto-spin below the display rate;
 * the same caps apply here: 30 fps, or 20 fps on small screens, few-core devices and the "lite"
 * marker style. Interaction (drag, zoom, turning to a node) always runs at full rate.
 */
export type EarthMarkerStyle = 'rich' | 'calm' | 'lite';

export function earthSpinFps(markerStyle: EarthMarkerStyle): number {
  const lowPower =
    markerStyle === 'lite' ||
    (typeof window !== 'undefined' && window.innerWidth < 640) ||
    ((typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 8) ?? 8) <= 4;
  return lowPower ? 20 : 30;
}

/** Below this sustained full-rate frame rate the earth stops spinning and pulsing. */
export const SLOW_DEVICE_FPS = 8;
