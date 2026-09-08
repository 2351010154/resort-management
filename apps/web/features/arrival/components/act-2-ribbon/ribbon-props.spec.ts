import { describe, expect, it } from "vitest";
import { BEATS, KNOTS } from "./ribbon-beats";
import { centre } from "./ribbon-geometry";
import { PROPS, propHeight, sinkAt } from "./ribbon-props";

// The widest common screens: 16:10, 16:9 and 21:9, as height over width.
const ASPECTS = [0.625, 0.5625, 0.4286];
// Copy block widths in vw, as the stylesheet sets them per beat.
const COPY_WIDTH: Record<string, number> = {
  light: 19,
  rooms: 25,
  water: 44,
  table: 30,
  stay: 27,
  horizon: 31,
};
const copyTop = (beat: (typeof BEATS)[number]) =>
  beat.y - (beat.onPhoto ? 27 : beat.id === "light" ? 9 : 18);
const overlaps = (a: [number, number], b: [number, number]) =>
  a[0] < b[1] && b[0] < a[1];

describe("ribbon props", () => {
  it("rest until they enter, sink monotonically, and settle at their drop", () => {
    for (const prop of PROPS) {
      expect(sinkAt(prop, prop.y - 100)).toBe(0);
      expect(sinkAt(prop, prop.y - 140)).toBe(0);
      let previous = 0;
      for (let camera = prop.y - 100; camera < prop.y + 200; camera++) {
        const sink = sinkAt(prop, camera);
        expect(sink).toBeGreaterThanOrEqual(previous);
        expect(sink).toBeLessThanOrEqual(prop.drop);
        previous = sink;
      }
      expect(previous).toBeCloseTo(prop.drop);
    }
  });
  it("clear every later opening and copy block in their column at full drop", () => {
    for (const prop of PROPS) {
      const span: [number, number] = [prop.x, prop.x + prop.size];
      for (const aspect of ASPECTS) {
        const bottom = prop.y + propHeight(prop, aspect) + prop.drop;
        for (const beat of BEATS) {
          if (
            copyTop(beat) > prop.y &&
            overlaps(span, [beat.x, beat.x + COPY_WIDTH[beat.id]])
          )
            expect(bottom, `${prop.id} into ${beat.id} copy`).toBeLessThan(
              copyTop(beat),
            );
          const opening = beat.aperture;
          if (!opening || opening.y - opening.r <= prop.y) continue;
          const cx = centre(KNOTS, opening.y, 0, false) + opening.dx;
          if (
            overlaps(span, [cx - opening.widthVw / 2, cx + opening.widthVw / 2])
          )
            expect(bottom, `${prop.id} into ${beat.id} opening`).toBeLessThan(
              opening.y - opening.r,
            );
        }
      }
    }
  });
});
