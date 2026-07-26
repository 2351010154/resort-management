import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // Three rules the React Compiler backs, which the arrival's WebGL and
      // scroll code cannot satisfy as written:
      //
      // immutability — driving a GLSL uniform means assigning to
      //   `uniforms.uX.value` every frame. Rebuilding the uniform set instead
      //   would recompile the material mid-scrub.
      // refs — act 1 reads its camera ref during render to hand the same
      //   mutable camera object to two children.
      // set-state-in-effect — six mount-time gates that ask an external system
      //   (matchMedia, Lenis, a decoded video) whether animation may start.
      //
      // Warnings, not errors: each one names a real pattern worth revisiting,
      // but the fix changes render timing, and the acts are pinned against
      // committed reference images.
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Spelling out the config's own defaults, because naming any ignores here
  // replaces them rather than adding to them.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
