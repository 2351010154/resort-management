// Which chapter the page is over, in one word: light or dark.
//
// Two pieces of fixed chrome need this answer and they have to agree — the bar
// and the dates rail sit one under the other, and a bar that has gone ivory over
// a rail still in ink would be two halves of the same object disagreeing about
// the hour. So the rule lives here rather than in either of them.
//
// The page turns its hour once, in chapter 4: the hinge runs ivory to night
// across its top two fifths, so by the time it owns the viewport centre the
// chrome is over ink — and every chapter after it is ink to the end of the page.
// Nothing hands it back, which is why this is a plain set plus the running
// claims rather than a set alone.
export const DARK_ACTS = new Set([4, 5, 6, 7, 8]);

/**
 * A claim only speaks for its own act. Reading "any act claims dark" made the
 * chrome inherit claims from acts that are nowhere near the viewport: an act
 * that takes the dark bar on enter holds it for as long as it is mounted, which
 * left the chrome ink over ivory on every scroll back up through the day
 * chapters.
 */
export function chapterIsDark(state: {
  activeAct: number;
  navDarkActs: readonly number[];
}): boolean {
  return (
    DARK_ACTS.has(state.activeAct) ||
    state.navDarkActs.includes(state.activeAct)
  );
}
