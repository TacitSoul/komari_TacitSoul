import { useState } from 'react';
import { getCountryCodeFromRegion } from '@/matrix/utils/geo';
import { cn } from '@/lib/utils';

/**
 * SVG region flag (Twemoji set under /assets/flags/<ISO>.svg).
 *
 * `region` is whatever Komari stores for the node — normally a flag emoji, sometimes an ISO
 * code or a country name. Unknown regions render the neutral "UN" flag; a missing file falls
 * back to a quiet placeholder so the layout never jumps.
 */
export function FlagIcon({
  region,
  size = 16,
  className,
  title,
}: {
  region?: string | null;
  /** Rendered height in px; the box is 4:3 like the emoji glyph it replaces. */
  size?: number;
  className?: string;
  title?: string;
}) {
  const code = getCountryCodeFromRegion(region) ?? 'UN';
  const src = `/assets/flags/${code}.svg`;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const width = Math.round((size * 4) / 3);

  if (failedSrc === src) {
    return (
      <span
        role="img"
        aria-label={title ?? code}
        title={title}
        className={cn('inline-block shrink-0 rounded-[3px] bg-muted/60', className)}
        style={{ width, height: size }}
      />
    );
  }

  return (
    <img
      src={src}
      alt={title ?? code}
      title={title}
      width={width}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn('inline-block shrink-0 select-none object-contain', className)}
      style={{ width, height: size }}
      onError={() => setFailedSrc(src)}
    />
  );
}
