import { STAFF_ROLES } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import { LANDING_BY_ROLE } from "@/lib/auth/landing-route";
import { hotkeyId } from "@/lib/keyboard/chord";

import {
  isActivePath,
  NAV_GROUPS,
  NAV_ITEMS,
  NAV_PREFIX,
  navCommandId,
  navItemsFor,
  navShortcut,
} from "./nav-inventory";

/* The map, held to the two documents that own it.
 *
 * Nothing here renders anything. What is worth proving about navigation is
 * decidable without a DOM — which role is offered what, that no two entries
 * want the same key, and that the rail and the landing agree — and those are
 * exactly the facts that break silently when a family is added months from now.
 */

describe("the navigation inventory", () => {
  it("gives every entry a distinct id, path and sequence key", () => {
    const ids = NAV_ITEMS.map((item) => item.id);
    const paths = NAV_ITEMS.map((item) => item.href);
    const keys = NAV_ITEMS.map((item) => item.key);

    expect(new Set(ids).size).toBe(NAV_ITEMS.length);
    expect(new Set(paths).size).toBe(NAV_ITEMS.length);
    expect(new Set(keys).size).toBe(NAV_ITEMS.length);
  });

  it("draws each sequence key from its own family's name", () => {
    // The rule that makes a key memorable rather than assigned. A new family
    // taking a letter it does not contain is the case this catches.
    for (const item of NAV_ITEMS) {
      expect(item.key).toMatch(/^[a-z]$/);
      expect(item.label.toLowerCase()).toContain(item.key);
    }
  });

  it("offers every entry to at least one role", () => {
    for (const item of NAV_ITEMS) {
      expect(item.roles.length).toBeGreaterThan(0);
    }
  });

  it("places every entry in one declared operational group", () => {
    const groups = new Set(NAV_GROUPS.map((group) => group.id));

    for (const item of NAV_ITEMS) {
      expect(groups.has(item.group)).toBe(true);
    }
  });

  it("names paths the landing routes can be reached at", () => {
    for (const item of NAV_ITEMS) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.href.endsWith("/")).toBe(false);
    }
  });
});

describe("what a role is offered", () => {
  it("starts every role on a screen its own navigation holds", () => {
    // The landing and the rail are two answers to "where does this person
    // work", and a role sent somewhere its own navigation does not list would
    // land on a screen it cannot get back to.
    for (const role of STAFF_ROLES) {
      const offered = navItemsFor(role).map((item) => item.href);

      expect(offered).toContain(LANDING_BY_ROLE[role]);
    }
  });

  it("keeps housekeeping on the board and away from money and guests", () => {
    const offered = navItemsFor("HOUSEKEEPING").map((item) => item.id);

    expect(offered).toEqual(["housekeeping"]);
  });

  it("offers the accountant the money without the desk's queues", () => {
    const offered = navItemsFor("ACCOUNTANT").map((item) => item.id);

    expect(offered).toContain("payments");
    expect(offered).toContain("finance");
    expect(offered).not.toContain("arrivals");
    expect(offered).not.toContain("departures");
  });

  it("withholds settings from everyone but management", () => {
    for (const role of STAFF_ROLES) {
      const offered = navItemsFor(role).map((item) => item.id);
      const management = role === "MANAGER" || role === "ADMIN";

      expect(offered.includes("settings")).toBe(management);
    }
  });

  it("gives the administrator the whole console", () => {
    expect(navItemsFor("ADMIN")).toEqual(NAV_ITEMS);
  });

  it("keeps the inventory's order", () => {
    const offered = navItemsFor("MANAGER").map((item) => item.id);
    const inventory = NAV_ITEMS.map((item) => item.id);

    expect(offered).toEqual(inventory.filter((id) => offered.includes(id)));
  });
});

describe("the sequence a navigation chord is written as", () => {
  it("writes the prefix and the key the way the registry reads them", () => {
    const [dashboard] = NAV_ITEMS;

    expect(dashboard.id).toBe("dashboard");
    expect(navShortcut(dashboard)).toBe("g d");
  });

  it("parses each half as a bare unmodified key", () => {
    // The sequence is two ordinary presses, and the registry only ever sees one
    // of them at a time. A key that parsed to anything with a modifier on it
    // would be bound as a chord nobody can reach by typing two letters.
    expect(hotkeyId(NAV_PREFIX, "other")).toBe(NAV_PREFIX);

    for (const item of NAV_ITEMS) {
      const [prefix, key] = navShortcut(item).split(" ");

      expect(prefix).toBe(NAV_PREFIX);
      expect(hotkeyId(key, "other")).toBe(item.key);
    }
  });

  it("namespaces the palette id by the family", () => {
    for (const item of NAV_ITEMS) {
      expect(navCommandId(item)).toBe(`nav.${item.id}`);
    }
  });
});

describe("which entry the operator is on", () => {
  it("marks the family a record belongs to", () => {
    expect(isActivePath("/bookings", "/bookings")).toBe(true);
    expect(isActivePath("/bookings/BK-1042", "/bookings")).toBe(true);
  });

  it("does not mark a family whose path merely starts the same way", () => {
    expect(isActivePath("/rooms-archive", "/rooms")).toBe(false);
    expect(isActivePath("/payments", "/pay")).toBe(false);
  });

  it("marks nothing on a path no family owns", () => {
    const marked = NAV_ITEMS.filter((item) =>
      isActivePath("/login", item.href),
    );

    expect(marked).toEqual([]);
  });
});
