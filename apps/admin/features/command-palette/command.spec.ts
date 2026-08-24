import { describe, expect, it } from "vitest";

import {
  COMMAND_GROUP_ORDER,
  type ConsoleCommand,
  commandValue,
  groupCommands,
} from "./command";

function command(
  id: string,
  overrides: Partial<ConsoleCommand> = {},
): ConsoleCommand {
  return {
    id,
    label: id,
    group: "actions",
    action: () => {},
    ...overrides,
  };
}

describe("groupCommands", () => {
  it("orders groups by the declared order, not by registration", () => {
    const groups = groupCommands([
      command("a", { group: "search" }),
      command("b", { group: "actions" }),
      command("c", { group: "navigation" }),
    ]);

    expect(groups.map((group) => group.id)).toEqual([
      "navigation",
      "actions",
      "search",
    ]);
  });

  it("keeps registration order within a group", () => {
    const groups = groupCommands([
      command("second"),
      command("first"),
      command("third"),
    ]);

    expect(groups[0].commands.map((one) => one.id)).toEqual([
      "second",
      "first",
      "third",
    ]);
  });

  it("omits a group with no members rather than heading an empty block", () => {
    const groups = groupCommands([command("only", { group: "actions" })]);

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("actions");
  });

  it("returns nothing at all when nothing is registered", () => {
    expect(groupCommands([])).toEqual([]);
  });

  it("keeps the first registration of an id and drops later ones", () => {
    // Registration order is child-before-parent, so first is the screen's and
    // second is the shell's: a screen overriding a shell command is the case
    // this rule exists for.
    const groups = groupCommands([
      command("shifts.open", { label: "Open the drawer for this desk" }),
      command("shifts.open", { label: "Open shift" }),
    ]);

    expect(groups[0].commands).toHaveLength(1);
    expect(groups[0].commands[0].label).toBe("Open the drawer for this desk");
  });

  it("drops a duplicate even when it claims a different group", () => {
    const groups = groupCommands([
      command("go.rooms", { group: "navigation" }),
      command("go.rooms", { group: "actions" }),
    ]);

    expect(groups.map((one) => one.id)).toEqual(["navigation"]);
  });

  it("labels every group it can emit", () => {
    const groups = groupCommands(
      COMMAND_GROUP_ORDER.map((group) => command(group, { group })),
    );

    expect(groups).toHaveLength(COMMAND_GROUP_ORDER.length);
    for (const group of groups) {
      expect(group.label).not.toBe("");
    }
  });
});

describe("commandValue", () => {
  it("puts the label, the keywords and the id in front of the filter", () => {
    const value = commandValue(
      command("arrivals.check-in", {
        label: "Check in",
        keywords: ["khách đến", "walk-in"],
      }),
    );

    expect(value).toContain("Check in");
    expect(value).toContain("khách đến");
    expect(value).toContain("arrivals.check-in");
  });

  it("does not include the shortcut, which is not a search term", () => {
    const value = commandValue(
      command("palette.open", { label: "Open", shortcut: "mod+k" }),
    );

    expect(value).not.toContain("mod+k");
  });
});
