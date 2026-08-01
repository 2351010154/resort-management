// The Arrival — one continuous ride through all six acts. Each act owns its
// own pin/scrub; the page only sequences them.

import { Act1Gathering } from "@/features/arrival/components/act-1-gathering/act-1-gathering";
import { WelcomeLine } from "@/features/arrival/components/act-2-welcome/welcome-line";
import { VideoSwell } from "@/features/arrival/components/act-3-approach/video-swell";
import { Act4Stay } from "@/features/arrival/components/act-4-stay/act-4-stay";
import { InvitationScreen } from "@/features/arrival/components/act-5-invitation/invitation-screen";
import { TurndownFooter } from "@/features/arrival/components/act-6-turndown/turndown-footer";

export default function ArrivalPage() {
  return (
    <>
      <main>
        <Act1Gathering />
        <WelcomeLine />
        <VideoSwell />
        <Act4Stay />
        <InvitationScreen />
      </main>
      <TurndownFooter />
    </>
  );
}
