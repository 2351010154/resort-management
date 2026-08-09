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
// deploy". The row is `system_config.business_date_rollover_hour` — the one §8
// means — and `SystemConfigService` is what reads it. The environment supplies
// the value the row is seeded with and nothing more; `config/env.ts` says why
// the first value arrives from there rather than from `property_tariff`.
//
// **So this is asynchronous and takes the caller's executor**, which is the
// whole cost of the sentence above and is worth stating plainly, because the
// cheaper shape was considered and rejected. That shape was to read the row once
// and hold the hour, keeping `current` synchronous: the row is one row, an
// `ADMIN` edits it, and a property realistically changes its audit hour once.
// The objection is that no cache in this process can see the edit that matters.
// The row is changed by a statement against the database — by hand today, and by
// an `ADMIN` screen tomorrow, possibly against another instance — so a held hour
// makes "changes one row, not a deploy" false: the property would be running on
// a different day from its own configuration, and nothing anywhere would say so.
// That is the identical silent divergence the environment was, moved one layer
// in and harder to see, and it is the class of defect §8 is written against.
//
// Taking the executor rather than reaching for the pool is `SystemConfigService`'s
// rule, and here it also settles what the read costs. Every caller either already
// held an executor or was about to open a transaction for the work the date is
// for, so the read joins a transaction that was being opened anyway. There is no
// new connection on any path, including the operational search.

import { fromDate, toCalendarDate } from "@internationalized/date";
import { PROPERTY_TIME_ZONE, type StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import type { DbExecutor } from "../../database/database.module.js";
import { SystemConfigService } from "../system-config/system-config.service.js";

@Injectable()
export class BusinessDateService {
  constructor(private readonly configuration: SystemConfigService) {}

  /**
   * The business date the given instant falls in. Defaults to now.
   *
   * `now` is a parameter so that a test, the night audit and a back-dated
   * correction can all ask the same question about a moment other than this
   * one. Everything else about the answer is fixed by the property's zone and
   * the configured hour.
   *
   * `exec` is required and never defaulted, for the reason `database.module.ts`
   * gives about writes and `system-config.service.ts` gives about reads: a
   * default would take the hour from a connection outside the caller's
   * transaction, so the date a booking is stamped with could come from a
   * snapshot other than the one the booking is written in.
   */
  async current(exec: DbExecutor, now: Date = new Date()): Promise<StayDate> {
    const rolloverHour =
      await this.configuration.businessDateRolloverHour(exec);

    // Read in the property's zone first, then discard the time. Doing it the
    // other way — taking the UTC date and adjusting — is the off-by-one this
    // service exists to prevent: 23:50 UTC is already tomorrow in UTC+7.
    const local = fromDate(now, PROPERTY_TIME_ZONE);
    const calendarDate = toCalendarDate(local);

    // Before the rollover, the property is still working the previous date.
    // `subtract` walks the calendar rather than the clock, so a month or year
    // boundary needs no special case.
    return local.hour < rolloverHour
      ? calendarDate.subtract({ days: 1 })
      : calendarDate;
  }
}
