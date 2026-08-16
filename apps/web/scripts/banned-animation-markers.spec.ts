import { describe, expect, it } from "vitest";
import { matchBannedPackages } from "./banned-animation-markers.ts";

// The budget check is only as good as this decision, and its failure mode is
// asymmetric. A missed package ships a WebGL bundle to a guest on a phone; a
// false alarm gets the whole check deleted by the next person whose green build
// turned red over a sentence of English. Both directions are asserted here,
// against content shaped like what Turbopack actually writes: minified,
// name-mangled, with the guest copy inlined as string literals.

/**
 * A funnel chunk as the budget check expects to find it — motion's runtime,
 * which the funnel legitimately loads, beside the guest copy of a booking step.
 *
 * The words are the trap. `motion` as a bare token matches chunks the funnel is
 * allowed to load, and a stay is described to a guest in exactly the vocabulary
 * a search for `three` would go looking for.
 */
const CLEAN_FUNNEL_CHUNK = `
(self.__next_f=self.__next_f||[]).push([1,'6:["$","div",null,{"className":"e_2f",
"children":["Sleeps three, with a sofa bed for a family of three.",
"Three nights, Thursday to Sunday.","Threshold rate from the third night."]}]']);
var an=e=>{let t=motionValue(0);return animate(t,1,{duration:.3,ease:"easeOut"})};
function useInViewRef(e,{amount:t="some",once:n=!0}={}){let r={threshold:t};
return useInView(e,r)}
var Vt=transform([0,1],[0,100]),Wt=useMotionValueEvent;
`;

describe("recognising the arrival's animation stack in a built chunk", () => {
  it("finds three by the devtools hook it registers on the window", () => {
    const chunk = `if(typeof __THREE_DEVTOOLS__!=="undefined"){__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}`;

    expect(matchBannedPackages(chunk)).toEqual([
      { name: "three", markerLabel: "__THREE_DEVTOOLS__" },
    ]);
  });

  it("finds three by the namespace it prefixes its own warnings with", () => {
    const chunk = `console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+i)`;

    expect(matchBannedPackages(chunk)).toEqual([
      { name: "three", markerLabel: "THREE.<Class>" },
    ]);
  });

  it("finds gsap by the cache it writes onto the element itself", () => {
    // A minifier cannot rename this: gsap reads it back off a DOM node.
    const chunk = `var t=e._gsap||(e._gsap=new Ee(e));return t.set(e,{x:0})`;

    expect(matchBannedPackages(chunk)).toEqual([
      { name: "gsap", markerLabel: "_gsap element cache" },
    ]);
  });

  it("finds gsap by its plugin registration and by its target warning", () => {
    const registration = `gsap.registerPlugin(ScrollTrigger)`;
    const warning = `i("GSAP target "+e+" not found. https://gsap.com")`;

    expect(matchBannedPackages(registration)).toEqual([
      { name: "gsap", markerLabel: "gsap.registerPlugin" },
    ]);
    expect(matchBannedPackages(warning)).toEqual([
      { name: "gsap", markerLabel: "GSAP target warning" },
    ]);
  });

  it("finds lenis by the version it publishes and the attribute it reads", () => {
    const version = `window.lenisVersion="1.1.17"`;
    const attribute = `if(e.closest("[data-lenis-prevent]"))return`;

    expect(matchBannedPackages(version)).toEqual([
      { name: "lenis", markerLabel: "window.lenisVersion" },
    ]);
    expect(matchBannedPackages(attribute)).toEqual([
      { name: "lenis", markerLabel: "data-lenis-prevent" },
    ]);
  });

  it("finds a package by the module path an unminified build leaves behind", () => {
    const chunk = `//# sourceMappingURL=../node_modules/three/build/three.module.js.map`;

    expect(matchBannedPackages(chunk)).toEqual([
      { name: "three", markerLabel: "three module path" },
    ]);
  });

  it("reports each package once, however many of its markers a chunk trips", () => {
    const chunk = [
      `__THREE_DEVTOOLS__ THREE.Vector3 /node_modules/three/build/`,
      `e._gsap gsap.registerPlugin(x)`,
      `window.lenisVersion="1.1.17" data-lenis-prevent`,
    ].join("\n");

    expect(matchBannedPackages(chunk)).toEqual([
      { name: "three", markerLabel: "__THREE_DEVTOOLS__" },
      { name: "gsap", markerLabel: "_gsap element cache" },
      { name: "lenis", markerLabel: "window.lenisVersion" },
    ]);
  });
});

describe("leaving alone what the funnel is allowed to ship", () => {
  it("does not flag a chunk of motion beside the guest's own copy", () => {
    expect(matchBannedPackages(CLEAN_FUNNEL_CHUNK)).toEqual([]);
  });

  it("does not read prose about three of something as the package", () => {
    // The namespace marker demands a capitalised member immediately after the
    // full stop. Prose puts a space there, even when the copy is shouted.
    const copy = "Sleeps three. A sofa bed makes it four. ALL THREE. THE REST.";

    expect(matchBannedPackages(copy)).toEqual([]);
  });

  it("does not let @react-three satisfy three's own module path", () => {
    const chunk = `from"../node_modules/@react-three/fiber/dist/index.js"`;

    expect(matchBannedPackages(chunk)).toEqual([]);
  });

  it("does not match an identifier that merely contains a marker", () => {
    // The element cache and the version global are whole names; a bundler that
    // emitted `_gsapLike` or `myLenisVersion` has shipped neither package.
    const chunk = `var _gsapLike=1,myLenisVersion="0",useThreeColumns=()=>3`;

    expect(matchBannedPackages(chunk)).toEqual([]);
  });
});
