export type BrandLogoTheme = 'deepspace' | 'clean';

const palettes: Record<BrandLogoTheme, {
  plateStart: string;
  plateEnd: string;
  ring: string;
  strokeA: string;
  strokeB: string;
  core: string;
  status: string;
}> = {
  deepspace: {
    plateStart: '#17314a',
    plateEnd: '#05070b',
    ring: '#22d3ee',
    strokeA: '#7cf4ff',
    strokeB: '#e879f9',
    core: '#eaffff',
    status: '#22c55e',
  },
  clean: {
    plateStart: '#f8fafc',
    plateEnd: '#e7eef3',
    ring: '#3157c8',
    strokeA: '#3157c8',
    strokeB: '#0e7490',
    core: '#111827',
    status: '#16a34a',
  },
};

/**
 * Tacit Soul mark: two facing arcs that never touch (the unspoken link) around a single core,
 * with a small status dot. Kept free of CSS variables so sharp/librsvg can rasterise it.
 */
export function getBrandLogoSvg(theme: BrandLogoTheme): string {
  const p = palettes[theme];
  return `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tacit Soul">
  <defs>
    <radialGradient id="plate" cx="48%" cy="30%" r="82%">
      <stop offset="0%" stop-color="${p.plateStart}"/>
      <stop offset="100%" stop-color="${p.plateEnd}"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#plate)"/>
  <g transform="translate(256 256)" stroke-linecap="round">
    <circle r="196" stroke="${p.ring}" stroke-opacity="0.4" stroke-width="12"/>
    <path d="M-44 -148 A156 156 0 0 0 -44 148" stroke="${p.strokeA}" stroke-width="34"/>
    <path d="M44 148 A156 156 0 0 0 44 -148" stroke="${p.strokeB}" stroke-width="34"/>
    <circle r="40" fill="${p.core}"/>
    <circle cx="139" cy="-139" r="18" fill="${p.status}" stroke="${p.plateEnd}" stroke-width="6"/>
  </g>
</svg>`;
}

export function getBrandLogoDataUri(theme: BrandLogoTheme): string {
  return `data:image/svg+xml,${encodeURIComponent(getBrandLogoSvg(theme))}`;
}
