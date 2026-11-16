import type { TFunction } from 'i18next';
import { normalizeBillingCycle, type NormalizedBillingCycle } from '@/matrix/utils/billing';

/**
 * Localised price label shared by the card and table views, e.g. "¥10/月", "$5.50/Quarter", "免费".
 * Komari: price 0 = not set (nothing shown), -1 = free. Cycle classification is the matrix card's
 * (`normalizeBillingCycle`), so every view names a cycle the same way.
 */
export function cycleLabel(cycle: NormalizedBillingCycle, t: TFunction): string {
  switch (cycle.kind) {
    case 'lifetime':
      return t('mcard.cycle.lifetime');
    case 'month':
      return t('mcard.cycle.month');
    case 'quarter':
      return t('mcard.cycle.quarter');
    case 'halfYear':
      return t('mcard.cycle.halfYear');
    case 'year':
      return (cycle.years ?? 1) === 1 ? t('mcard.cycle.year') : t('mcard.cycle.years', { count: cycle.years });
    case 'days':
      return t('mcard.cycle.days', { count: cycle.days });
  }
}

const INTEGER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatPriceLabel(
  price: number,
  currency: string | null | undefined,
  billingCycle: number | string | null | undefined,
  t: TFunction,
): string | null {
  if (!Number.isFinite(price) || price === 0) return null;
  if (price === -1) return t('mcard.free');
  if (price < 0) return null;
  const symbol = currency?.trim() || '¥';
  const amount = (Number.isInteger(price) ? INTEGER : DECIMAL).format(price);
  return `${symbol}${amount}/${cycleLabel(normalizeBillingCycle(billingCycle), t)}`;
}
