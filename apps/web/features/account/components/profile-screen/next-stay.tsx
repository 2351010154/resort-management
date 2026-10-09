// The profile's first panel: the guest's next stay — or the way to one.
//
// **The room, not a row.** A guest who has a stay coming is reading their
// profile with it in mind, and the funnel already holds a photograph of every
// room type; so the next stay opens the page the way the arrival shows a room
// (`stay-feature.tsx`). The rest of the history is the bar's "Stays", one
// press away, so the panel does not repeat the way there.
//
// **No stay ahead is an invitation, not an empty state.** The panel keeps its
// place and its frame and holds the property at dusk instead — "Until you
// return." to a guest who has stayed before, "Until you arrive." to one who
// has not — with the way into the calendar under it.
//
// Which stay counts as next is `stay-history.ts`'s decision, made against the
// property's today, so this screen and the stays list cannot disagree about it.

import { today } from "@internationalized/date";
import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import { Panel } from "@/features/account/components/account-frame/panel";
import {
  StayFeature,
  StayInvitation,
} from "@/features/account/components/stay-feature/stay-feature";
import { standingOf, stayHistory } from "@/features/account/lib/stay-history";
import type { OwnStay } from "@/features/account/lib/stays";

export function NextStay({ stays }: { readonly stays: readonly OwnStay[] }) {
  const now = today(PROPERTY_TIME_ZONE);
  const { upcoming, past } = stayHistory(stays, now.toString());
  const next = upcoming[0];

  if (!next) {
    return (
      <Panel title="Your next stay">
        <StayInvitation
          title={past.length > 0 ? "Until you return." : "Until you arrive."}
        />
      </Panel>
    );
  }

  // A stay the guest is standing in is not their next one.
  const present = standingOf(next.state).tone === "present";

  return (
    <Panel title={present ? "Your stay" : "Your next stay"}>
      <StayFeature stay={next} today={now} />
    </Panel>
  );
}
