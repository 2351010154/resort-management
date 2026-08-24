"use client";

import { REVENUE_BUCKETS } from "@mariva/shared";
import type * as React from "react";
import { useId } from "react";

import { KeyHint } from "@/components/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { BUCKET_LABELS, type RangeFields } from "./reports";

/* The range a report is asked over — two inclusive trading days and how to cut
 * them.
 *
 * **A component of its own rather than markup on a screen, because
 * `screens.md` gives every report page "a range picker, a chart and an Excel
 * export" and the picker is the piece the pages have in common.** Two of the
 * three mount it unchanged — revenue, and occupancy/ADR/RevPAR, whose queries
 * `contract/reporting.ts` builds from one helper for exactly that reason. The
 * third does not: a live count over `room_condition` has no stretch of days to
 * cut, so the room-status page carries the boundary stamp and the instant it was
 * counted instead of a control that would filter nothing.
 *
 * **The bucket sits inside the picker rather than beside the chart**, because
 * "which days" and "cut how" are one question — a reader who narrows to a
 * fortnight and leaves the cut on quarters has asked for one bar, and the two
 * controls submitting together is what stops that being two round trips to find
 * out.
 *
 * `/` reaches the first day on every screen in this console with filters, and
 * this takes the ref for it rather than reaching for the DOM itself: the hotkey
 * belongs to the screen, which is where every other one in the console is bound.
 */

export function RangePicker({
  fields,
  firstDayField,
  pending,
  onChange,
  onSubmit,
}: {
  fields: RangeFields;
  firstDayField?: React.Ref<HTMLInputElement>;
  /** Whether the report behind it is being read, so the act can disable in
   *  place rather than paint something. */
  pending: boolean;
  onChange(fields: RangeFields): void;
  onSubmit(): void;
}) {
  return (
    <form
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Day
          label="From"
          value={fields.from}
          placeholder="the first trading day"
          inputRef={firstDayField}
          onChange={(from) => {
            onChange({ ...fields, from });
          }}
        />
        <Day
          label="To"
          value={fields.to}
          placeholder="the last, inclusive"
          onChange={(to) => {
            onChange({ ...fields, to });
          }}
        />
        <Cut
          value={fields.bucket}
          onChange={(bucket) => {
            onChange({ ...fields, bucket });
          }}
        />
        <div className="flex items-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Reading" : "Show the report"}
          </Button>
        </div>
      </div>

      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-sm">
        {/* Said rather than implied: both ends are the trading day the property
            was working and not the calendar day the clock had reached, which is
            what puts a walk-in taken at 01:30 in the night it was sold. Leaving
            an end empty is a real question — "everything so far" — and the last
            day is cut at the boundary whatever is typed. */}
        <KeyHint>/</KeyHint>
        <span>First day</span>
        <span>Inclusive trading days</span>
        <span>Empty means no bound</span>
      </div>
    </form>
  );
}

/** One end of the range. Typed liberally — "16/8", "today" — and read against
 *  the property's own day by `rangeQuestion`, never against this machine's
 *  calendar. */
function Day({
  label,
  value,
  placeholder,
  inputRef,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange(value: string): void;
}) {
  const fieldId = useId();

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        {label}
      </label>
      <Input
        id={fieldId}
        ref={inputRef}
        className="mt-1"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

/** How the range is cut. Every bucket the contract has, from its own tuple, so
 *  a fourth one added there is offered here without this file being touched. */
function Cut({
  value,
  onChange,
}: {
  value: RangeFields["bucket"];
  onChange(value: RangeFields["bucket"]): void;
}) {
  const fieldId = useId();

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        Grouped by
      </label>
      <select
        id={fieldId}
        className="border-input mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        value={value}
        onChange={(event) => {
          onChange(event.target.value as RangeFields["bucket"]);
        }}
      >
        {REVENUE_BUCKETS.map((bucket) => (
          <option key={bucket} value={bucket}>
            {BUCKET_LABELS[bucket]}
          </option>
        ))}
      </select>
    </div>
  );
}
