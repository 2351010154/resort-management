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
 * How far above Act 2's own top the ribbon's stage reaches, in viewport
 * heights: the room the sheet is allowed to draw in over Act 1's photograph.
 *
 * A whole viewport, so that at the moment Act 1's pin releases — Act 2's top
 * at the fold — the ribbon's stage already covers the entire screen, and the
 * photograph it keeps registered behind the sheet is the one the reader sees.
 */
export const ACT2_OVERHANG = 100;

/**
 * How far above Act 2's own top the ribbon's crest is actually drawn, and
 * therefore how long Act 1 keeps its photograph pinned after the greeting.
 *
 * The overhang is room, not ink: the crest's highest point stands about 13vh
 * above Act 2's top and nothing is drawn over the photograph higher than that.
 * Holding Act 1 for the whole overhang used to leave most of a screen of scroll
 * in which the picture stood untouched while an invisible part of the stage
 * went past. Held for exactly the crest's rise, the paper starts climbing the
 * frame on the first scroll after the greeting has gone. The ribbon's spec
 * guards the crest against drawing any higher than this.
 */
export const ACT2_CREST_RISE = 14;

/**
 * How long before Act 1's pin releases Act 2 takes over the photograph, in
 * viewport heights.
 *
 * Both acts paint the same picture, and Act 2's copy sits in a stage box that
 * rises from the foot of the screen over the last viewport of Act 1's pin —
 * drawn any earlier, its edge wipes up across whatever Act 1 still has on it.
 * So Act 2 keeps its copy hidden until this point, and Act 1 has to have lifted
 * every letter of its greeting off the picture by then. The margin is only
 * there so the two never disagree by a rounding step on the frame the pin lets
 * go: from here to the release both frames are the same pixels.
 */
export const ACT1_HANDOVER_LEAD = 2;

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

/**
 * How far Act 4's experience field reaches up under the corridor, in viewport
 * heights.
 *
 * The corridor's statement is held on its pin until the field pins over it,
 * and the field draws nothing while it travels up into place. Laid end to end,
 * that travel was a whole screen of scroll with the sentence standing still
 * and nothing else moving. Reaching up by most of it leaves the statement a
 * short dwell to be read in, and the field's hand-off sheet starts soon after.
 */
export const ACT4_FIELD_REACH = 75;

/** The share of the overhang the bands themselves run across: the last screen
 *  of the field's pin, which is the whole of the time the Invitation is behind
 *  them. The screen above it is the reading, standing still. */
export const ACT4_WIPE = ACT4_OVERHANG / 2;
