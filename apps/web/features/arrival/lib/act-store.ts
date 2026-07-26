// Discrete UI signals only — continuous scroll progress lives in
// refs/ScrollTrigger, never in React state.

import { create } from "zustand";

export type NavPhase = "top" | "scrolled" | "island";

interface ArrivalActState {
  /** Which of the 6 acts currently owns the viewport. */
  activeAct: number;
  menuOpen: boolean;
  navPhase: NavPhase;
  /**
   * Acts sitting on a dark backdrop right now. Act identity alone cannot tell
   * the nav which theme it is over: Acts 1 and 4 both start dark and hand the
   * bar back part-way through their own scroll.
   *
   * A list of claims rather than one flag, because more than one act writes it
   * and their lifecycles overlap — a pinned act is still mounted while the next
   * one takes the viewport, and its teardown would otherwise clear a claim it
   * never made.
   */
  navDarkActs: readonly number[];
  setActiveAct: (act: number) => void;
  setMenuOpen: (open: boolean) => void;
  setNavPhase: (phase: NavPhase) => void;
  /** Claim or release the dark bar for one act. Idempotent. */
  setNavDark: (act: number, dark: boolean) => void;
}

export const useArrivalActStore = create<ArrivalActState>((set) => ({
  activeAct: 1,
  menuOpen: false,
  navPhase: "top",
  navDarkActs: [],
  setActiveAct: (activeAct) => set({ activeAct }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setNavPhase: (navPhase) => set({ navPhase }),
  setNavDark: (act, dark) =>
    set((state) => {
      if (state.navDarkActs.includes(act) === dark) return state;
      return {
        navDarkActs: dark
          ? [...state.navDarkActs, act]
          : state.navDarkActs.filter((claim) => claim !== act),
      };
    }),
}));
