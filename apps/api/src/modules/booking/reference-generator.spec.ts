import { describe, expect, it, vi } from "vitest";
import {
  BOOKING_REFERENCE_ALPHABET,
  BOOKING_REFERENCE_ATTEMPTS,
  BOOKING_REFERENCE_GROUP_SIZE,
  generateBookingReference,
  isBookingReference,
  retryOnCollision,
} from "./reference-generator.js";

/** Picks the given indices in order, so a generated reference is an assertion. */
function picks(...indices: readonly number[]): (bound: number) => number {
  let call = 0;
  return () => indices[call++ % indices.length];
}

describe("the alphabet", () => {
  // The characters a guest reading a reference down a phone line turns into
  // each other. Their absence is the reason the alphabet is 31 and not 36.
  it.each(["0", "1", "I", "L", "O"])("excludes %s", (character) => {
    expect(BOOKING_REFERENCE_ALPHABET).not.toContain(character);
  });

  it("holds no character twice", () => {
    const symbols = [...BOOKING_REFERENCE_ALPHABET];
    expect(new Set(symbols).size).toBe(symbols.length);
  });
});

describe("a generated reference", () => {
  it("is two groups of four, hyphenated", () => {
    const reference = generateBookingReference(picks(0));

    expect(reference).toBe("2222-2222");
    expect(reference).toHaveLength(BOOKING_REFERENCE_GROUP_SIZE * 2 + 1);
  });

  it("draws each symbol from the alphabet in order", () => {
    // 0, 1, 2 … maps to the first eight symbols of the alphabet.
    expect(generateBookingReference(picks(0, 1, 2, 3, 4, 5, 6, 7))).toBe(
      "2345-6789",
    );
  });

  it("asks for an index inside the alphabet", () => {
    const randomIndex = vi.fn<(bound: number) => number>(() => 0);
    generateBookingReference(randomIndex);

    expect(randomIndex).toHaveBeenCalledTimes(BOOKING_REFERENCE_GROUP_SIZE * 2);
    for (const [bound] of randomIndex.mock.calls) {
      expect(bound).toBe(BOOKING_REFERENCE_ALPHABET.length);
    }
  });

  it("is recognised by the pattern M7 routes on", () => {
    // Unseeded — the real source of randomness, over enough draws that a symbol
    // outside the alphabet would surface.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(isBookingReference(generateBookingReference())).toBe(true);
    }
  });
});

describe("recognising a reference", () => {
  it.each([
    ["k7qx-2m9p", "lowercase"],
    ["K7QX2M9P", "no hyphen"],
    ["K7QX-2M9", "too short"],
    ["K7QX-2M9PX", "too long"],
    ["K7QX-2M0P", "an excluded digit"],
    ["K7QI-2M9P", "an excluded letter"],
    ["", "nothing at all"],
  ])("refuses %s — %s", (candidate) => {
    expect(isBookingReference(candidate)).toBe(false);
  });
});

describe("retrying a collision", () => {
  it("inserts once when the reference is free", async () => {
    const insert = vi.fn(async (reference: string) => reference);

    const result = await retryOnCollision(insert, () => true, picks(0));

    expect(result).toBe("2222-2222");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("tries a different reference after a collision", async () => {
    const collision = new Error("duplicate key value violates unique constraint");
    const insert = vi
      .fn<(reference: string) => Promise<string>>()
      .mockRejectedValueOnce(collision)
      .mockImplementation(async (reference) => reference);

    const result = await retryOnCollision(
      insert,
      (error) => error === collision,
      picks(0, 0, 0, 0, 0, 0, 0, 0, 1),
    );

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).toBe("2222-2222");
    expect(insert.mock.calls[1][0]).not.toBe("2222-2222");
    expect(result).toBe(insert.mock.calls[1][0]);
  });

  // The failure this loop must not paper over. A foreign key to a room type
  // that does not exist would be retried forever as bad luck, and each retry
  // would fail identically.
  it("rethrows anything that is not a collision, without retrying", async () => {
    const other = new Error("insert or update violates foreign key constraint");
    const insert = vi.fn(async () => {
      throw other;
    });

    await expect(
      retryOnCollision(insert, () => false, picks(0)),
    ).rejects.toBe(other);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("gives up after the third collision and rethrows the last error", async () => {
    const errors = [new Error("first"), new Error("second"), new Error("third")];
    let call = 0;
    const insert = vi.fn(async () => {
      throw errors[call++];
    });

    await expect(
      retryOnCollision(insert, () => true, picks(0)),
    ).rejects.toBe(errors[BOOKING_REFERENCE_ATTEMPTS - 1]);
    expect(insert).toHaveBeenCalledTimes(BOOKING_REFERENCE_ATTEMPTS);
  });
});
