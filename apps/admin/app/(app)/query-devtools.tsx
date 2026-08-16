"use client";

/* The query inspector, and only where it belongs.
 *
 * A panel that shows every cached query, its key, its age and its last error is
 * worth a great deal while eleven screens are being built against one cache,
 * and it is roughly a hundred kilobytes of JavaScript that no operator will
 * ever open.
 *
 * The condition is written as a ternary over `process.env.NODE_ENV` rather than
 * as `{isDev && <Devtools />}` inside the provider's markup, because the two
 * are not the same for the bundler. Next inlines `NODE_ENV` at build time, so
 * in a production build this reads `"production" === "development"`, the
 * bundler folds it to false, and the `import()` in the dead branch is never
 * turned into a chunk — the package is absent from the output rather than
 * shipped and skipped. Rendering it conditionally would have imported it
 * unconditionally.
 *
 * `ssr: false` because the panel is a browser tool inspecting a browser cache;
 * there is nothing for it to render on the server and nothing to hydrate.
 */

import dynamic from "next/dynamic";

export const QueryDevtools =
  process.env.NODE_ENV === "development"
    ? dynamic(
        () =>
          import("@tanstack/react-query-devtools").then(
            (module) => module.ReactQueryDevtools,
          ),
        { ssr: false },
      )
    : () => null;
