// The Arrival — one continuous ride through all six acts. Each act owns its
// own pin/scrub; the page only sequences them.

import { Act1Arrival } from "@/features/arrival/components/act-1-arrival/act-1-arrival";
import { WelcomeLine } from "@/features/arrival/components/act-2-welcome/welcome-line";
import { VideoSwell } from "@/features/arrival/components/act-3-approach/video-swell";
import { Act4Stay } from "@/features/arrival/components/act-4-stay/act-4-stay";
import { InvitationScreen } from "@/features/arrival/components/act-5-invitation/invitation-screen";
import { TurndownFooter } from "@/features/arrival/components/act-6-turndown/turndown-footer";

export default function ArrivalPage() {
  return (
    <>
      <main>
        <Act1Arrival />
        <WelcomeLine />
        <VideoSwell />
        <Act4Stay />
        <InvitationScreen />
      </main>
      <TurndownFooter />
    </>
  );
}
