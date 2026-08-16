// What the arrival's animation stack looks like once it has been minified, and
// the one function that decides whether a chunk contains it.
//
// This lives beside `check-bundle-budget.ts` rather than inside it because the
// budget check reads `.next`, resolves packages and exits the process, none of
// which a unit test can do — while the decision it is trusted for is a pure
// question about a string. Splitting the decision out is what makes it
// testable, and the markers are the part most likely to need changing.
//
// Written in CommonJS, like its caller: `apps/web/package.json` declares no
// `"type"`, so the check runs under Node's type stripping and `require` of this
// module is a plain synchronous read with no second parse.

/**
 * What a banned package looks like once Turbopack has minified it.
 *
 * A bare token search is not usable here. `three` matches "threshold", `motion`
 * matches four of this build's chunks including two the funnel legitimately
 * loads, and `lenis` matches any identifier a minifier happened to keep. A
 * check that cries wolf gets deleted, so every marker below is a string the
 * package itself authors and a minifier must preserve — a namespace prefix
 * inside a warning, a property name written onto a DOM element, a global, a
 * data attribute. Names, not vocabulary.
 *
 * The module path is listed alongside them because it is the marker that would
 * survive an unminified build, and because it is the one that stays true when a
 * package rewrites its internals. It is anchored on both sides by separators so
 * `node_modules/three/` cannot be satisfied by `node_modules/@react-three/`.
 */
export const BANNED_PACKAGES: ReadonlyArray<{
  name: string;
  markers: ReadonlyArray<{ label: string; pattern: RegExp }>;
}> = [
  {
    name: "three",
    markers: [
      { label: "__THREE_DEVTOOLS__", pattern: /__THREE_DEVTOOLS__/ },
      // three prefixes every console warning with its own namespace, e.g.
      // `THREE.Quaternion: .setFromEuler() ...`. Requiring an immediately
      // adjacent capitalised member keeps English prose ("...all three. The
      // rest") from matching, since prose puts a space after the full stop.
      { label: "THREE.<Class>", pattern: /(?<![\w$])THREE\.[A-Z][A-Za-z0-9]+/ },
      {
        label: "three module path",
        pattern: /[\\/]node_modules[\\/]three[\\/]/,
      },
    ],
  },
  {
    name: "gsap",
    markers: [
      // gsap caches its per-element state on a `_gsap` property of the element
      // itself, so the name cannot be mangled and cannot be dropped.
      { label: "_gsap element cache", pattern: /(?<![\w$])_gsap(?![\w$])/ },
      { label: "gsap.registerPlugin", pattern: /gsap\.registerPlugin/ },
      { label: "GSAP target warning", pattern: /GSAP target/ },
      { label: "gsap module path", pattern: /[\\/]node_modules[\\/]gsap[\\/]/ },
    ],
  },
  {
    name: "lenis",
    markers: [
      {
        label: "window.lenisVersion",
        pattern: /(?<![\w$])lenisVersion(?![\w$])/,
      },
      { label: "data-lenis-prevent", pattern: /data-lenis-prevent/ },
      {
        label: "lenis module path",
        pattern: /[\\/]node_modules[\\/]lenis[\\/]/,
      },
    ],
  },
];

export type BannedPackageMatch = {
  /** The package the source is carrying. */
  name: string;
  /** The marker that recognised it, so a failure names its own evidence. */
  markerLabel: string;
};

/**
 * Which banned packages this source contains, in the order they are declared
 * above, naming for each one the first marker that recognised it.
 *
 * One match per package rather than per marker: a chunk that carries three
 * trips several of its markers at once, and repeating the same package three
 * times in a build failure teaches the reader nothing the first line did not.
 */
export function matchBannedPackages(source: string): BannedPackageMatch[] {
  const matches: BannedPackageMatch[] = [];
  for (const banned of BANNED_PACKAGES) {
    const hit = banned.markers.find((marker) => marker.pattern.test(source));
    if (hit) matches.push({ name: banned.name, markerLabel: hit.label });
  }
  return matches;
}
