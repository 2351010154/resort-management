// The two seams Act 2's ribbon makes with its neighbours, in viewport heights.
//
// They live here rather than in the ribbon because each is a number two acts
// have to agree on. Act 1 holds its photograph for exactly as long as the
// ribbon needs to be born over it; Act 3 lets the ribbon's stage overlap its
// own pinned frame for exactly as long as the last aperture takes to open.
// One act reading the other's constant is a dependency in the wrong direction;
// both reading this file is a contract.

/**
 * How far above Act 2's own top the ribbon starts, and therefore how long Act
 * 1 keeps its photograph pinned after the push has finished.
 *
 * The ribbon is born as a band rising over the held picture, and the band and
 * the lobe under it have to be entirely on screen — the first aperture looking
 * back through at the photograph — before the picture is allowed to scroll
 * away. A whole viewport is what that takes: at the moment the pin releases,
 * Act 2's top is at the fold and everything above it is ribbon.
 */
export const ACT2_OVERHANG = 100;

/**
 * How far Act 3's section reaches up under Act 2's, so that its pinned frame
 * is already the whole screen while the ribbon's stage is still over it.
 *
 * The frame pins when Act 3's top reaches the top of the viewport, and the
 * ribbon's stage is stuck until Act 2 has one viewport left. The stretch where
 * both are true is the overlap less one viewport, and that stretch is the lens.
 */
export const ACT2_LENS_TRAVEL = 60;
export const ACT2_ACT3_OVERLAP = 100 + ACT2_LENS_TRAVEL;
