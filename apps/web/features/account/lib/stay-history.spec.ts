import type { BookingState } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import { isAhead, standingOf, stayHistory } from "./stay-history";

const TODAY = "2026-08-17";

const stay = (
  reference: string,
  state: BookingState,
  checkIn: string,
  checkOut: string,
) => ({ reference, state, checkIn, checkOut });

/** Referenced by the order they are expected to come back in, not by date. */
const NEXT_WEEK = stay("MAR-2001", "CONFIRMED", "2026-08-24", "2026-08-27");
const TOMORROW = stay("MAR-2002", "CONFIRMED", "2026-08-18", "2026-08-20");
const IN_HOUSE = stay("MAR-2003", "CHECKED_IN", "2026-08-15", "2026-08-19");
const LAST_MONTH = stay("MAR-2004", "CHECKED_OUT", "2026-07-02", "2026-07-05");
const LAST_YEAR = stay("MAR-2005", "CHECKED_OUT", "2025-11-11", "2025-11-14");
const CALLED_OFF = stay("MAR-2006", "CANCELLED", "2026-09-01", "2026-09-03");
const MISSED = stay("MAR-2007", "NO_SHOW", "2026-06-01", "2026-06-03");

describe("stayHistory", () => {
  it("puts what is coming before what has been", () => {
    const { upcoming, past } = stayHistory([LAST_MONTH, TOMORROW], TODAY);

    expect(upcoming).toEqual([TOMORROW]);
    expect(past).toEqual([LAST_MONTH]);
  });

  it("runs the upcoming stays forwards, nearest arrival first", () => {
    // The API answers newest-arrival-first for every state at once, so the
    // order below is the opposite of the one this list is given.
    expect(
      stayHistory([NEXT_WEEK, TOMORROW, IN_HOUSE], TODAY).upcoming,
    ).toEqual([IN_HOUSE, TOMORROW, NEXT_WEEK]);
  });

  it("runs the past stays backwards, most recent arrival first", () => {
    expect(stayHistory([LAST_YEAR, MISSED, LAST_MONTH], TODAY).past).toEqual([
      LAST_MONTH,
      MISSED,
      LAST_YEAR,
    ]);
  });

  it("keeps a stay the guest is standing in among the upcoming ones", () => {
    // Half-open [checkIn, checkOut): a guest who arrived on Saturday and leaves
    // on Wednesday is mid-stay, and filing it under "past" would tell them
    // their current stay is over.
    expect(stayHistory([IN_HOUSE], TODAY).upcoming).toEqual([IN_HOUSE]);
  });

  it("files a cancelled stay in the future under what has been", () => {
    // There is nothing left to act on, so it does not belong above the stays
    // that still have something owing on them.
    expect(stayHistory([CALLED_OFF], TODAY).past).toEqual([CALLED_OFF]);
  });

  it("drops nothing — a stay that went wrong still happened", () => {
    const history = stayHistory([CALLED_OFF, MISSED, TOMORROW], TODAY);

    expect(history.upcoming.length + history.past.length).toBe(3);
  });

  it("answers two empty groups for an account with no stays", () => {
    expect(stayHistory([], TODAY)).toEqual({ upcoming: [], past: [] });
  });

  it("keeps one order for two stays arriving the same day", () => {
    const second = stay("MAR-2009", "CONFIRMED", "2026-08-24", "2026-08-26");
    const first = stay("MAR-2008", "CONFIRMED", "2026-08-24", "2026-08-26");

    expect(stayHistory([second, first], TODAY).upcoming).toEqual([
      first,
      second,
    ]);
  });
});

describe("isAhead", () => {
  it("counts the departure day itself as still ahead", () => {
    expect(
      isAhead(stay("MAR-2010", "CHECKED_IN", "2026-08-14", TODAY), TODAY),
    ).toBe(true);
  });

  it("counts the day after departure as behind", () => {
    expect(
      isAhead(stay("MAR-2011", "CONFIRMED", "2026-08-14", "2026-08-16"), TODAY),
    ).toBe(false);
  });

  it("reads the state before the dates", () => {
    expect(isAhead(CALLED_OFF, TODAY)).toBe(false);
  });
});

describe("standingOf", () => {
  it("names the three states screens.md names", () => {
    expect(standingOf("CONFIRMED").label).toBe("Upcoming");
    expect(standingOf("CHECKED_OUT").label).toBe("Completed");
    expect(standingOf("CANCELLED").label).toBe("Cancelled");
  });

  it("gives the other two words of their own rather than a wrong one", () => {
    // A guest in the room has not "completed" anything, and a missed arrival
    // was neither completed nor cancelled.
    expect(standingOf("CHECKED_IN").label).toBe("In stay");
    expect(standingOf("NO_SHOW").label).toBe("No-show");
  });

  it("reads a hold as the stay it is — one not yet taken", () => {
    expect(standingOf("HELD").label).toBe("Upcoming");
  });
});
