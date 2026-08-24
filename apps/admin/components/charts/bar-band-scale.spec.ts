import { scaleBand } from "@visx/scale";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BAR_WIDTH,
  insetBandScale,
  resolveRenderedBandWidth,
} from "./bar-band-scale";

const PLOT_WIDTH = 1500;
const BAR_GAP = 0.2;

function bandScaleFor(count: number) {
  return scaleBand<string>({
    range: [0, PLOT_WIDTH],
    domain: Array.from({ length: count }, (_, i) => `b${i}`),
    padding: BAR_GAP,
  });
}

describe("resolveRenderedBandWidth", () => {
  it("holds a sparse chart's band to the cap", () => {
    expect(
      resolveRenderedBandWidth({
        bandwidth: bandScaleFor(1).bandwidth(),
        maxBarWidth: DEFAULT_MAX_BAR_WIDTH,
      }),
    ).toBe(DEFAULT_MAX_BAR_WIDTH);
  });

  it("leaves a dense chart's band alone", () => {
    const bandwidth = bandScaleFor(30).bandwidth();
    expect(bandwidth).toBeLessThan(DEFAULT_MAX_BAR_WIDTH);
    expect(
      resolveRenderedBandWidth({
        bandwidth,
        maxBarWidth: DEFAULT_MAX_BAR_WIDTH,
      }),
    ).toBe(bandwidth);
  });

  it("lets an explicit bar width override the cap", () => {
    expect(
      resolveRenderedBandWidth({
        bandwidth: bandScaleFor(1).bandwidth(),
        barWidth: 400,
        maxBarWidth: DEFAULT_MAX_BAR_WIDTH,
      }),
    ).toBe(400);
  });
});

describe("insetBandScale", () => {
  // The x-axis label, the crosshair and the tooltip dots are all placed at
  // `barScale(category) + bandWidth / 2`. A capped bar that did not move would
  // pull all four to the left edge of its band.
  it.each([1, 2, 4])("keeps %i bar(s) on their band centres", (count) => {
    const scale = bandScaleFor(count);
    const drawn = insetBandScale(scale, DEFAULT_MAX_BAR_WIDTH);

    for (const category of scale.domain()) {
      const trueCentre = (scale(category) ?? 0) + scale.bandwidth() / 2;
      const drawnCentre = (drawn(category) ?? 0) + drawn.bandwidth() / 2;
      expect(drawnCentre).toBeCloseTo(trueCentre, 6);
    }
  });

  it("draws at the capped width and keeps the bar inside its band", () => {
    const scale = bandScaleFor(1);
    const drawn = insetBandScale(scale, DEFAULT_MAX_BAR_WIDTH);

    expect(drawn.bandwidth()).toBe(DEFAULT_MAX_BAR_WIDTH);
    expect(drawn("b0") ?? 0).toBeGreaterThan(scale("b0") ?? 0);
    expect((drawn("b0") ?? 0) + drawn.bandwidth()).toBeLessThanOrEqual(
      (scale("b0") ?? 0) + scale.bandwidth(),
    );
  });

  it("returns the scale untouched when the band already fits", () => {
    const scale = bandScaleFor(30);
    expect(insetBandScale(scale, scale.bandwidth())).toBe(scale);
  });

  // Bar-depth measures the gap between bands from `step()`, so the copy has to
  // carry the layout methods, not just the call signature.
  it("carries the underlying scale's step", () => {
    const scale = bandScaleFor(4);
    const drawn = insetBandScale(scale, DEFAULT_MAX_BAR_WIDTH);
    expect(drawn.step()).toBe(scale.step());
  });
});
