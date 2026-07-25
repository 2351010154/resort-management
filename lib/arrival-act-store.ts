// Discrete UI signals only — continuous scroll progress lives in
// refs/ScrollTrigger, never in React state.

import { create } from "zustand";

export type NavPhase = "top" | "scrolled" | "island";

interface ArrivalActState {
  /** Which of the 6 acts currently owns the viewport. */
  activeAct: number;
  menuOpen: boolean;
  navPhase: NavPhase;
  /** A light act can darken mid-scroll (Act 1); act identity alone can't tell
   *  the nav which theme it is sitting on. */
  navDark: boolean;
  setActiveAct: (act: number) => void;
  setMenuOpen: (open: boolean) => void;
  setNavPhase: (phase: NavPhase) => void;
  setNavDark: (dark: boolean) => void;
}

export const useArrivalActStore = create<ArrivalActState>((set) => ({
  activeAct: 1,
  menuOpen: false,
  navPhase: "top",
  navDark: false,
  setActiveAct: (activeAct) => set({ activeAct }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setNavPhase: (navPhase) => set({ navPhase }),
  setNavDark: (navDark) => set({ navDark }),
}));
