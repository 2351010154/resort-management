import type { scaleBand } from "@visx/scale";

type BandScale = ReturnType<typeof scaleBand<string>>;

/** Widest a band draws by default. A band scale hands its only category ~80%
 *  of the plot, so a one-bucket chart on a desk-width screen draws a 1500px
 *  slab and reads as a filled panel rather than as a bar. 96px is the console's
 *  comfortable maximum: wide enough to carry a stack's segments and a rounded
 *  cap, narrow enough that four buckets still read as four bars. */
export const DEFAULT_MAX_BAR_WIDTH = 96;

/** What a band actually paints: its own width held to `maxBarWidth`, unless the
 *  caller named an exact `barWidth`, which overrides the cap. */
export function resolveRenderedBandWidth({
  bandwidth,
  barWidth,
  maxBarWidth,
}: {
  bandwidth: number;
  barWidth?: number;
  maxBarWidth: number;
}): number {
  return barWidth ?? Math.min(bandwidth, maxBarWidth);
}

/** A band scale that draws `bandWidth` wide, centred in the band it came from.
 *
 * Every consumer places from `barScale(category) + bandWidth / 2` — the bars,
 * the axis labels, the crosshair and the tooltip dots — so shifting the scale
 * by half the slack keeps all four on the same centre as the uncapped band
 * would have given them. Returned unchanged for a dense chart, where the band
 * is already narrower than the cap.
 *
 * `step()` and the rest of the scale's methods are copied across untouched:
 * they describe the layout the categories are laid out on, not the paint, and
 * the bar-depth geometry reads `step()` to measure the gap between bands.
 */
export function insetBandScale(scale: BandScale, bandWidth: number): BandScale {
  const inset = (scale.bandwidth() - bandWidth) / 2;
  if (inset <= 0) {
    return scale;
  }
  const shifted = (value: string) => {
    const position = scale(value);
    return position === undefined ? undefined : position + inset;
  };
  return Object.assign(shifted, scale, {
    bandwidth: () => bandWidth,
  }) as unknown as BandScale;
}
