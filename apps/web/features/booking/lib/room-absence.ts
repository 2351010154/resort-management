// What is missing from the list, in a sentence rather than a section.
//
// The rooms a guest cannot take used to be a labelled block under the list —
// a caps heading and one line per room, four of them reading "Superior — not
// free for these nights." in a column. Every line said the same thing, the
// heading said it a fifth time, and the block was the last thing on the screen,
// which gave the most weight on the page to the rooms the guest has no decision
// to make about.
//
// **Demoted, never hidden — still.** A guest who cannot see the Superior at all
// concludes the hotel has no such room; a guest who reads one line concludes it
// is not free this week. The second is true and the first is not. What changed
// is the register: the fact is worth a sentence beside the list, not a section
// under it.
//
// Two sentences at most, because the system can produce exactly two rejections
// today. A third means a third rejection reason exists, and that is a
// `stay-quote.ts` change rather than a copy change.

import type { RoomType } from "./room-types";
import { type Party, partySize } from "./stay-quote";

/** Party sizes this property can be asked for — `booking-search.ts` caps it at 4. */
const NUMBER_WORDS = ["nobody", "one", "two", "three", "four"] as const;

function inWords(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/**
 * The room names as a reader would say them: "A", "A and B", "A, B and C".
 *
 * No serial comma before the "and", which is the house style everywhere else in
 * the funnel's prose.
 */
function nameList(types: readonly RoomType[]): string {
  const names = types.map((type) => type.name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One sentence per reason a room is not on the list, or none at all.
 *
 * Returned as separate strings rather than one joined paragraph so the caller
 * decides the punctuation between them — and so a test can read the two
 * independently, which is the half of this that actually goes wrong: the verb
 * has to agree with a list that is one name on most dates and four on some.
 */
export function absenceNotes(
  partition: {
    readonly soldOut: readonly RoomType[];
    readonly tooSmall: readonly RoomType[];
  },
  party: Party,
): readonly string[] {
  const notes: string[] = [];

  if (partition.soldOut.length > 0) {
    const verb = partition.soldOut.length === 1 ? "is" : "are";
    notes.push(
      `${nameList(partition.soldOut)} ${verb} not free for these nights.`,
    );
  }

  if (partition.tooSmall.length > 0) {
    const verb = partition.tooSmall.length === 1 ? "is" : "are";
    const guests = partySize(party);
    notes.push(
      `${nameList(partition.tooSmall)} ${verb} too small for ` +
        `${inWords(guests)} ${guests === 1 ? "guest" : "guests"}.`,
    );
  }

  return notes;
}
