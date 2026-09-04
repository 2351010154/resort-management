// The Arrival — one opening that changes from view to room to reservation.
//
// Nine chapters where there were six acts, and the order is the argument: the
// threshold says what and where, the deck gives a bookable room second, the table
// and the hinge carry the day into the evening, the rituals and the place are the
// ink half, and the page's last question is the dates. Chapter 8 is the house at
// rest.
//
// The page only sequences them. Each chapter is a static composition — the
// transitions belong to phase 4 — so the whole ride reads with every scrub
// disabled, which is the gate this order was chosen to pass.

import { Chapter1Threshold } from "@/features/arrival/components/chapter-1-threshold/chapter-1-threshold";
import { Chapter2Stay } from "@/features/arrival/components/chapter-2-stay/chapter-2-stay";
import { Chapter3Table } from "@/features/arrival/components/chapter-3-table/chapter-3-table";
import { Chapter4Dusk } from "@/features/arrival/components/chapter-4-dusk/chapter-4-dusk";
import { Chapter5Rituals } from "@/features/arrival/components/chapter-5-rituals/chapter-5-rituals";
import { Chapter6Place } from "@/features/arrival/components/chapter-6-place/chapter-6-place";
import { Chapter7Dates } from "@/features/arrival/components/chapter-7-dates/chapter-7-dates";
import { TurndownFooter } from "@/features/arrival/components/act-6-turndown/turndown-footer";

export default function ArrivalPage() {
  return (
    <>
      <main>
        <Chapter1Threshold />
        <Chapter2Stay />
        <Chapter3Table />
        <Chapter4Dusk />
        <Chapter5Rituals />
        <Chapter6Place />
        <Chapter7Dates />
      </main>
      <TurndownFooter />
    </>
  );
}
