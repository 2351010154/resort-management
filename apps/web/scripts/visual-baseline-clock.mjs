// The page's own clock, replaced before any application script runs.
//
// Every moving part of the arrival is driven from requestAnimationFrame:
// GSAP's ticker, Lenis' smoothing loop, R3F's render loop, and the room deck's
// performance.now() drift. Left alone they advance on wall-clock time, so two
// captures of the same scroll position differ by however long the machine took
// to get there — which is the opposite of a regression baseline.
//
// The frame loop is replaced outright: callbacks queue up and only run when
// step() drains them, with a timestamp step() controls. Nothing in the page
// moves between steps, and a step costs nothing — under SwiftShader the real
// frame rate on the WebGL acts is a few per second, so waiting on real frames
// would put the capture into the tens of minutes.
//
// This is safe only because the capture takes its picture through CDP.
// page.screenshot waits for the page to hand over a stable frame by asking for
// a requestAnimationFrame of its own, which a queue nothing drains never
// answers — that combination deadlocks.
//
// Time advances one frame at a time rather than in a single jump: Lenis'
// smoothing and the deck's spring integrate per frame, and a 2.5s delta does
// not land where 150 frames of 1/60s land.
//
// Exported as a string rather than a function because Playwright's
// addInitScript serialises it into the page, where this module does not exist.

/** Fixed wall-clock origin, so Date.now() is stable across runs too. */
const ORIGIN = 1735689600000; // 2025-01-01T00:00:00Z

export const VIRTUAL_CLOCK = `(() => {
  const FRAME = 1000 / 60;
  const ORIGIN = ${ORIGIN};
  let now = 0;

  let queue = [];
  let nextId = 1;

  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue = queue.filter((entry) => entry.id !== id);
  };

  performance.now = () => now;
  Date.now = () => ORIGIN + now;

  // Media is deliberately left alone here. Playback does advance on a clock
  // this cannot reach, but stubbing play() out is worse than the problem: an
  // element that is never played is, for several of these videos, never
  // decoded either, and an undecoded video is a black texture. The capture
  // pauses and seeks each one to a fixed frame instead, which pins it just as
  // firmly and leaves it with something to show.

  window.__baselineClock = {
    /** Run the queued frame callbacks \`frames\` times, advancing 1/60s each. */
    step(frames) {
      for (let i = 0; i < frames; i++) {
        now += FRAME;
        const due = queue;
        queue = [];
        for (const entry of due) {
          try {
            entry.cb(now);
          } catch {
            // A throwing callback is the app's problem, not the harness';
            // the rest of the frame still has to run or it is not a frame.
          }
        }
      }
    },
    now: () => now,
    pending: () => queue.length,
  };
})();`;
