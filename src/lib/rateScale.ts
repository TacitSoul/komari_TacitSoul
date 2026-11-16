const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;
const NICE_STEPS = [
  50 * KIB, 100 * KIB, 200 * KIB, 500 * KIB,
  MIB, 2 * MIB, 5 * MIB, 10 * MIB, 20 * MIB, 50 * MIB, 100 * MIB, 200 * MIB, 300 * MIB, 400 * MIB,
  500 * MIB, 800 * MIB, GIB, 2 * GIB, 5 * GIB,
];

/** Round a chart's axis maximum up to a tidy value so the scale reads "400 MB/s, 200 MB/s, 0". */
export function niceRateCeiling(value: number): number {
  if (!(value > 0)) return 100 * KIB;
  for (const step of NICE_STEPS) if (value <= step) return step;
  return Math.ceil(value / GIB) * GIB;
}
