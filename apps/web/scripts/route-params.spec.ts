import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Holds a page's declared `params` to the directory names it actually sits in.
//
// Nothing else does. Next generates a validator into `.next/types` that looks
// like it checks this, but it types a page's props as
// `{ params: Promise<ParamMap[Route]> } & any`, and an intersection with `any`
// is `any` — so a page may claim any parameter names it likes and both `tsc`
// and `next build` will agree with it. Layouts are checked for real there
// (`LayoutProps<Route>` carries no `& any`), which is why this only sweeps
// pages.
//
// The failure it exists for: someone renames `[hold]` to `[holdId]`, the
// hand-written `Promise<{ hold: string }>` keeps compiling, and the funnel step
// destructures `undefined` at runtime. Loud when it happens, but only on the
// first navigation of that flow, and only if someone walks it.
//
// The alternative was adopting Next's generated `PageProps<"/route">`, which
// does have teeth. It resolves only after `next typegen` has written
// `.next/types`, which a fresh checkout has not, so the CI type-check would
// have to generate it — and that writes into the `.next/**` that turbo's build
// task claims as its output, with nothing in the task graph ordering the two.
// This costs a file and no build coupling.

/** Where the route tree starts, resolved from this file rather than the cwd. */
const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

/**
 * The parameter names a route path promises, read from its directory names.
 *
 * Route groups — `(booking)` — are organisational and name no parameter. The
 * three dynamic forms all yield the bare name: `[hold]`, the catch-all
 * `[...segments]`, and the optional catch-all `[[...segments]]`. Only the name
 * is taken. A catch-all's value is an array rather than a string, but nobody
 * renames a directory into a catch-all by accident, whereas mistyping a name is
 * exactly the slip this is here for.
 */
function routeParamKeys(routePath: string): string[] {
  return routePath
    .split("/")
    .slice(0, -1)
    .map((segment) => /^\[{1,2}(?:\.\.\.)?([^[\]]+)\]{1,2}$/.exec(segment)?.[1])
    .filter((name): name is string => name !== undefined);
}

/**
 * The parameter names a page's own type annotation declares.
 *
 * `null` means the page declares no `params` at all, which is legitimate — a
 * page under a dynamic segment is free to ignore it, as the account screen and
 * the console's catch-all both do.
 *
 * Throws rather than guesses when a page annotates `params` in a shape this
 * cannot read. A tripwire that quietly skips what it does not understand is
 * worse than no tripwire, because it reports green over the case it was written
 * for. `searchParams` is not matched: the capital P puts it outside `\bparams`.
 */
function declaredParamKeys(source: string): string[] | null {
  const annotation = /params\s*:\s*Promise\s*<\s*\{([\s\S]*?)\}\s*>/.exec(
    source,
  );

  if (!annotation) {
    if (/\bparams\s*:/.test(source)) {
      throw new Error(
        "page annotates `params` in a shape this spec cannot read; " +
          "teach `declaredParamKeys` the new shape rather than deleting the case",
      );
    }
    return null;
  }

  return [
    ...annotation[1].matchAll(/(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??:/g),
  ].map((key) => key[1]);
}

describe("reading a route's parameters from its directory names", () => {
  it("names the parameter a dynamic segment carries", () => {
    expect(routeParamKeys("(booking)/booking/[hold]/details/page.tsx")).toEqual(
      ["hold"],
    );
  });

  it("reads a route group as organisation, not a parameter", () => {
    expect(routeParamKeys("(booking)/login/page.tsx")).toEqual([]);
    expect(routeParamKeys("(marketing)/page.tsx")).toEqual([]);
  });

  it("takes the bare name from either catch-all form", () => {
    expect(routeParamKeys("(app)/[...unbuilt]/page.tsx")).toEqual(["unbuilt"]);
    expect(routeParamKeys("shop/[[...slug]]/page.tsx")).toEqual(["slug"]);
  });

  it("keeps nested parameters in the order the path walks them", () => {
    expect(
      routeParamKeys("bookings/[reference]/nights/[night]/page.tsx"),
    ).toEqual(["reference", "night"]);
  });

  it("ignores the file name itself, which is never a segment", () => {
    expect(routeParamKeys("[hold]/page.tsx")).toEqual(["hold"]);
  });
});

describe("reading the parameters a page declares", () => {
  it("reads the funnel's own annotation, readonly modifiers and all", () => {
    const source = `export default async function HoldDetailsPage({
  params,
}: {
  readonly params: Promise<{ readonly hold: string }>;
}) {
  const { hold } = await params;
}`;

    expect(declaredParamKeys(source)).toEqual(["hold"]);
  });

  it("reads a page that declares two", () => {
    const source = `{ params: Promise<{ reference: string; night: string }> }`;

    expect(declaredParamKeys(source)).toEqual(["reference", "night"]);
  });

  it("says nothing about a page that declares no parameters", () => {
    const source = `export default function AccountPage() {
  // params is mentioned in prose here, and nowhere else.
  return null;
}`;

    expect(declaredParamKeys(source)).toBeNull();
  });

  it("leaves searchParams alone", () => {
    const source = `{ searchParams: Promise<{ ref: string }> }`;

    expect(declaredParamKeys(source)).toBeNull();
  });

  it("refuses a shape it cannot read rather than reporting green", () => {
    const source = `{ params: HoldRouteParams }`;

    expect(() => declaredParamKeys(source)).toThrow(/cannot read/);
  });
});

describe("the funnel's pages agree with the tree they sit in", () => {
  const pages = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split(/[\\/]/).join("/"))
    .filter((entry) => entry.endsWith("page.tsx"))
    .sort();

  const declaring = pages
    .map((page) => ({
      page,
      declared: declaredParamKeys(readFileSync(`${APP_DIR}/${page}`, "utf8")),
    }))
    .filter(
      (entry): entry is { page: string; declared: string[] } =>
        entry.declared !== null,
    );

  // Both counts guard the sweep itself. A glob that silently matches nothing
  // passes every assertion below it, which is the shape of green this whole
  // file exists to distrust.
  it("found the route tree", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it("found pages that take parameters", () => {
    expect(declaring.length).toBeGreaterThan(0);
  });

  it.each(declaring)(
    "$page declares what its path carries",
    ({ page, declared }) => {
      expect([...declared].sort()).toEqual([...routeParamKeys(page)].sort());
    },
  );
});
