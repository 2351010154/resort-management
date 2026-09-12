// The seams one act makes with the next, in viewport heights.
//
// They live here rather than in either act because each is a number two acts
// have to agree on. Act 1 holds its photograph for exactly as long as the
// ribbon needs to be born over it; Act 3 lets the ribbon's stage overlap its
// own pinned frame for exactly as long as the last aperture takes to open;
// Act 5 reaches up under Act 4 for exactly as long as Act 4's hand-over takes
// to close over it. One act reading the other's constant is a dependency in
// the wrong direction; both reading this file is a contract.

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

/**
 * How far Act 5's section reaches up under Act 4's experience field, in
 * viewport heights, so that the field's stage is still pinned — and still the
 * whole screen — while the five bands of the hand-over close over it.
 *
 * The last two screens of the field's pin are what this buys. The lower one is
 * the wipe: Act 5's stage is sticky, so the moment its section's top passes the
 * top of the viewport the Invitation is stuck behind the pinned field, and the
 * bands close on the photograph rather than on the dusk fallback or on nothing
 * at all. The upper one is the screen the field's own pin end (`bottom bottom`)
 * reserves, which the wipe now occupies instead of leaving as a screen the
 * reader scrolls through after the act has already ended.
 *
 * Without it the two spans collide: the field's section bottom and Act 5's top
 * are the same document position, so the pin releases on the frame the wipe
 * starts on and every band is painted onto a stage that is already travelling
 * off the top of the screen, over an act arriving from below it. What the
 * reader reads then is the STAY screen going black, not a hand-over.
 */
export const ACT4_OVERHANG = 200;

/** The share of the overhang the bands themselves run across: the last screen
 *  of the field's pin, which is the whole of the time the Invitation is behind
 *  them. The screen above it is the reading, standing still. */
export const ACT4_WIPE = ACT4_OVERHANG / 2;
