import { getRegionDisplayName, cn } from '@/lib/utils';
import { getCountryCodeFromRegion } from '@/matrix/utils/geo';
import { FlagIcon } from './FlagIcon';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';

type RegionFlagSize = 'sm' | 'md' | 'lg';
type RegionFlagTooltipSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * RegionFlag — compact geographic identity badge.
 *
 * Tooltip is enabled by default because most surfaces only show the flag.
 * Set `showTooltip={false}` when the region name is already visible nearby.
 */
export function RegionFlag({
  region,
  size = 'sm',
  className,
  showTooltip = true,
  tooltipSide = 'bottom',
}: {
  region?: string;
  size?: RegionFlagSize;
  className?: string;
  showTooltip?: boolean;
  tooltipSide?: RegionFlagTooltipSide;
}) {
  if (!region) return null;
  const code = getCountryCodeFromRegion(region);
  const displayName = getRegionDisplayName(region);

  const ariaLabel = displayName || code || region;
  const tooltipLabel = showTooltip ? displayName : '';

  const px = size === 'lg' ? 20 : size === 'md' ? 16 : 13;

  const chip = (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center justify-center shrink-0 cursor-default select-none', className)}
    >
      <FlagIcon region={region} size={px} />
    </span>
  );

  if (!tooltipLabel) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side={tooltipSide} className="text-xs font-mono">
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}
