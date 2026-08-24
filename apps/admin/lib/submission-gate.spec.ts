import { describe, expect, it, vi } from "vitest";

import { enterSubmissionGate, leaveSubmissionGate } from "./submission-gate";

describe("the console submission gate", () => {
  it("admits only one same-turn submission and reopens after finally", async () => {
    const gate = { current: false };
    const mutate = vi.fn(async () => undefined);
    let finish: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });

    async function submit() {
      if (!enterSubmissionGate(gate)) return;
      try {
        await mutate();
        await held;
      } finally {
        leaveSubmissionGate(gate);
      }
    }

    const first = submit();
    const duplicate = submit();
    expect(mutate).toHaveBeenCalledTimes(1);

    finish?.();
    await Promise.all([first, duplicate]);
    await submit();
    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
