import { clamp01 } from "./ribbon-pacing";

// Small objects resting on the sheet, filling the ivory a lobe leaves empty.
// Each rests where it is authored (page units, like a beat), then sinks a
// bounded distance at its own pace as the reader scrolls past, turning a
// little as it goes, and settles. The bound is what keeps every prop out of
// the lobe below it: at full drop the prop still clears that lobe's opening
// and copy, so props may overlap each other's trail but never a photograph,
// a heading, or the navigation.
export interface Prop {
  id: string;
  src: string;
  width: number;
  height: number;
  /** Resting position of the top-left corner: x in vw, y in vh from the act's top. */
  x: number;
  y: number;
  /** Rendered width in vw. */
  size: number;
  /** Resting tilt in degrees. */
  tilt: number;
  /** How many vh it sinks per vh of camera travel while still falling. */
  rate: number;
  /** The total distance it may sink, in vh, before it settles. */
  drop: number;
  /** How far it turns over the whole drop, in degrees. */
  spin: number;
  /** Camera range over which it fades away, when the paper alone would not carry it off in time. */
  fade?: readonly [number, number];
}

const image = (name: string, width: number, height: number) => ({
  src: `/images/act-2-ribbon/${name}.webp`,
  width,
  height,
});

// One still life per lobe, read as a day at the house. The tea fell out of
// the first opening's photograph: the pot rests where the chapter trail
// begins and the cup sits on the trail, both gone before the rooms opening
// reaches them. Stones wait under the rooms note. In the water passage a
// ladle hangs high in the ivory band and its pour, seated over the ladle's
// own stream, sinks faster than it does, so the scroll stretches the water.
// At the table the dish of oil sits on the ivory beside the photograph's
// lower left.
export const PROPS: readonly Prop[] = [
  {
    id: "teapot",
    ...image("trail-teapot", 480, 480),
    x: 72,
    y: 58,
    size: 11,
    tilt: -12,
    rate: 0.24,
    drop: 18,
    spin: -6,
    fade: [64, 92],
  },
  {
    id: "teacup",
    ...image("trail-teacup", 480, 360),
    x: 41,
    y: 82,
    size: 6,
    tilt: 8,
    rate: 0.16,
    drop: 8,
    spin: 10,
    fade: [70, 92],
  },
  {
    id: "spa-stones",
    ...image("spa-stones", 640, 399),
    x: 10,
    y: 160,
    size: 8,
    tilt: -4,
    rate: 0.12,
    drop: 6,
    spin: 0,
  },
  {
    id: "water-ladle",
    ...image("water-ladle", 590, 640),
    x: 80,
    y: 204,
    size: 8,
    tilt: 0,
    rate: 0.08,
    drop: 6,
    spin: 4,
  },
  {
    id: "water-splash",
    ...image("water-splash", 268, 640),
    x: 85,
    y: 211,
    size: 4,
    tilt: 0,
    rate: 0.12,
    drop: 18,
    spin: -3,
  },
  {
    id: "olive-oil",
    ...image("olive-oil", 640, 584),
    x: 2,
    y: 350,
    size: 10,
    tilt: -5,
    rate: 0.14,
    drop: 8,
    spin: 4,
  },
];

/** How far through its drop a prop is at this camera position, 0 to 1. */
export function dropProgress(prop: Prop, camera: number): number {
  // Falling starts as the prop enters at the bottom of the screen; the ease
  // out is the settle, so the drop ends without a corner.
  const linear = clamp01(((camera - (prop.y - 100)) * prop.rate) / prop.drop);
  return 1 - (1 - linear) ** 2;
}

/** How far a prop has sunk from its resting place at this camera position. */
export function sinkAt(prop: Prop, camera: number): number {
  return prop.drop * dropProgress(prop, camera);
}

/** The rendered height of a prop in vh on a viewport of this aspect (height over width). */
export function propHeight(prop: Prop, aspect: number): number {
  return (prop.size * prop.height) / prop.width / aspect;
}
