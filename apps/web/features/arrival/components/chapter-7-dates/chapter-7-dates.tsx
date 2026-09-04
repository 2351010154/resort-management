"use client";

// Chapter 7 — "Choose dates". The aperture as the frame around the form.
//
// An ivory card on ink: the one lit surface in the dark half of the page, which is
// the whole hierarchy of the ending — the page's last question is the only thing
// with a light behind it.
//
// The card does not own what it collects. `arrival-booking-draft.ts` does, so the
// compact rail under the bar and the room deck's `Book your stay` are asking the
// same question as this card and get the same answer; a range typed into the rail
// is already in these fields when the reader arrives here.
//
// **Two submits, and both are real.** The form is still a GET to `/booking` with
// the funnel's own param names, so with JavaScript off the dates and the adults
// survive the navigation. With JavaScript on, the handler takes over — because
// child ages are the one thing a plain GET cannot carry: the codec wants them as
// one comma-separated `ages` param and three separate selects submit three
// params, of which `readBookingSearch` reads the first and silently loses the
// rest. So the age selects have no `name`, and `writeBookingSearch` joins them.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CHECK_IN_TIME, CHECK_OUT_TIME } from "@mariva/shared";
import { ApertureFrame } from "@/features/arrival/components/aperture/aperture-frame";
import {
  type DraftErrors,
  useArrivalBookingDraftStore,
  useArrivalDraft,
  validateDraft,
} from "@/features/arrival/lib/arrival-booking-draft";
import {
  MAX_ADULTS,
  MAX_CHILDREN,
  MAX_CHILD_AGE,
  writeBookingSearch,
} from "@/features/booking/lib/booking-search";
import styles from "./chapter-7-dates.module.css";

const ADULT_OPTIONS = Array.from({ length: MAX_ADULTS }, (_, i) => i + 1);
const CHILD_SLOTS = Array.from({ length: MAX_CHILDREN }, (_, i) => i);
const AGE_OPTIONS = Array.from({ length: MAX_CHILD_AGE + 1 }, (_, i) => i);

export function Chapter7Dates() {
  const router = useRouter();
  const draft = useArrivalDraft();
  const setFrom = useArrivalBookingDraftStore((s) => s.setFrom);
  const setTo = useArrivalBookingDraftStore((s) => s.setTo);
  const setAdults = useArrivalBookingDraftStore((s) => s.setAdults);
  const setChildAge = useArrivalBookingDraftStore((s) => s.setChildAge);

  // Empty until the guest has pressed once. Validating as they type would put a
  // red line under "arrival date" before they have reached the field.
  const [errors, setErrors] = useState<DraftErrors>({});

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    router.push(`/booking${writeBookingSearch(result.search)}`);
  };

  return (
    <section data-act={7} className={styles.section}>
      <ApertureFrame tone="ink" className={styles.frame}>
        <form
          className={styles.form}
          action="/booking"
          method="get"
          onSubmit={submit}
          noValidate
        >
          {/* The no-JavaScript path's step. Safe as a fixed value:
              `readBookingSearch` normalises the step back to the dates screen
              whenever the range is incomplete, so a submit with an empty or
              reversed range still lands somewhere true. */}
          <input type="hidden" name="step" value="rooms" />

          <div className={styles.head}>
            <span className={`caps-label ${styles.eyebrow}`}>Choose dates</span>
            <h2 className={`font-display ${styles.headline}`}>
              Two dates, and who is coming.
            </h2>
          </div>

          <div className={styles.fields}>
            <label className={styles.field} htmlFor="arrival-from">
              <span className="caps-label">Arrive</span>
              <input
                id="arrival-from"
                className={styles.control}
                type="date"
                name="from"
                value={draft.from}
                onChange={(e) => setFrom(e.target.value)}
                aria-invalid={errors.from ? true : undefined}
                aria-describedby={
                  errors.from ? "arrival-from-error" : undefined
                }
              />
              {errors.from ? (
                <span id="arrival-from-error" className={styles.error}>
                  {errors.from}
                </span>
              ) : null}
            </label>

            <label className={styles.field} htmlFor="arrival-to">
              <span className="caps-label">Depart</span>
              <input
                id="arrival-to"
                className={styles.control}
                type="date"
                name="to"
                value={draft.to}
                onChange={(e) => setTo(e.target.value)}
                aria-invalid={errors.to ? true : undefined}
                aria-describedby={errors.to ? "arrival-to-error" : undefined}
              />
              {errors.to ? (
                <span id="arrival-to-error" className={styles.error}>
                  {errors.to}
                </span>
              ) : null}
            </label>

            <label className={styles.field} htmlFor="arrival-adults">
              <span className="caps-label">Adults</span>
              <select
                id="arrival-adults"
                className={styles.control}
                name="adults"
                value={String(draft.adults)}
                onChange={(e) => setAdults(Number.parseInt(e.target.value, 10))}
                aria-invalid={errors.adults ? true : undefined}
                aria-describedby={
                  errors.adults ? "arrival-adults-error" : undefined
                }
              >
                {ADULT_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
              {errors.adults ? (
                <span id="arrival-adults-error" className={styles.error}>
                  {errors.adults}
                </span>
              ) : null}
            </label>

            {CHILD_SLOTS.map((slot) => (
              <label
                key={slot}
                className={styles.field}
                htmlFor={`arrival-child-${slot + 1}`}
              >
                <span className="caps-label">Child {slot + 1}</span>
                <select
                  id={`arrival-child-${slot + 1}`}
                  className={styles.control}
                  value={
                    draft.childAges[slot] === null
                      ? ""
                      : String(draft.childAges[slot])
                  }
                  onChange={(e) =>
                    setChildAge(
                      slot,
                      e.target.value === ""
                        ? null
                        : Number.parseInt(e.target.value, 10),
                    )
                  }
                  aria-invalid={errors.children ? true : undefined}
                  aria-describedby={
                    errors.children ? "arrival-children-error" : undefined
                  }
                >
                  <option value="">—</option>
                  {AGE_OPTIONS.map((age) => (
                    <option key={age} value={age}>
                      {age === 0 ? "Under 1" : `${age}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {errors.children ? (
            <p id="arrival-children-error" className={styles.error}>
              {errors.children}
            </p>
          ) : null}

          {/* One live region for the whole card, so a guest who cannot see the
              lines under the fields still hears why the press did nothing. */}
          <p className={styles.assertive} role="alert">
            {Object.values(errors).join(" ")}
          </p>

          <div className={styles.foot}>
            <button type="submit" className={`caps-label ${styles.submit}`}>
              Search rooms
            </button>
            {/* The only claim on the card, and it is the published clock the
                pre-arrival mail prints. */}
            <p className={`caps-label ${styles.clock}`}>
              Check-in from {CHECK_IN_TIME} · Check-out by {CHECK_OUT_TIME}
            </p>
          </div>
        </form>
      </ApertureFrame>
    </section>
  );
}
