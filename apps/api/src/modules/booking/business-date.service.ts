// What day it is *for the property* — `property-and-tariff.md` §2.
//
// Not the calendar date, and the difference is the single most common source of
// off-by-one-night reporting errors. The business date rolls at 04:00 in
// Ho Chi Minh City, so a walk-in taken at 01:30 on 15 August belongs to business
// date 14 August: the night audit has not run, the 14th has not been closed, and
// a booking stamped the 15th would land in a period that is already reported.
//
// It returns a `StayDate` — a `CalendarDate`, never an instant (`NFR-12`).
// `stay-date.ts` makes the argument at length and it applies twice as hard here,
// because this is the one place in the tree that *holds* an instant and has to
// put it down: a caller handed a timestamp back would compare it against a stay
// boundary in whatever zone it happened to be in, which is the bug this whole
// type exists to make uncompilable.
//
// The rollover hour is configuration and not a constant, because §2 says so
// outright: "a property that runs its audit at 06:00 changes one row, not a
// deploy". Today that value arrives from the environment; `config/env.ts` says
// why it arrives from there rather than from `property_tariff`, and what
// replaces it at `M6`. Nothing below reads the source — it reads the number —
// so that replacement is a change to one provider and not to this file.

import { fromDate, toCalendarDate } from "@internationalized/date";
import { PROPERTY_TIME_ZONE, type StayDate } from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ENV, type Env } from "../../config/env.js";

@Injectable()
export class BusinessDateService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * The business date the given instant falls in. Defaults to now.
   *
   * `now` is a parameter so that a test, the night audit and a back-dated
   * correction can all ask the same question about a moment other than this
   * one. Everything else about the answer is fixed by the property's zone and
   * the configured hour.
   */
  current(now: Date = new Date()): StayDate {
    // Read in the property's zone first, then discard the time. Doing it the
    // other way — taking the UTC date and adjusting — is the off-by-one this
    // service exists to prevent: 23:50 UTC is already tomorrow in UTC+7.
    const local = fromDate(now, PROPERTY_TIME_ZONE);
    const calendarDate = toCalendarDate(local);

    // Before the rollover, the property is still working the previous date.
    // `subtract` walks the calendar rather than the clock, so a month or year
    // boundary needs no special case.
    return local.hour < this.env.BUSINESS_DATE_ROLLOVER_HOUR
      ? calendarDate.subtract({ days: 1 })
      : calendarDate;
  }
}
