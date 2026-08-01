// The contract root: one definition the API implements and the client calls, so
// a route that changes shape breaks both sides at compile time instead of at
// runtime in whichever one was deployed second.
//
// Domain contracts join here as their modules are built — inventory and pricing
// at M3. Nothing is listed speculatively; an entry with no implementation is a
// promise the type system will hold the client to and nobody can keep.

import { health } from "./health.js";

export const contract = {
  health,
};

export type Contract = typeof contract;
