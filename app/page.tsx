// The Arrival — one continuous ride through all seven acts. Each act owns its
// own pin/scrub; the page only sequences them.

import { Act1Gathering } from "@/components/acts/act-1-gathering/act-1-gathering";
import { WelcomeLine } from "@/components/acts/act-2-welcome/welcome-line";
import { VideoSwell } from "@/components/acts/act-3-approach/video-swell";
import { ArrivalCard } from "@/components/acts/act-4-first-impression/arrival-card";
import { Act5Exhale } from "@/components/acts/act-5-exhale/act-5-exhale";
import { InvitationScreen } from "@/components/acts/act-6-invitation/invitation-screen";
import { TurndownFooter } from "@/components/acts/act-7-turndown/turndown-footer";

export default function ArrivalPage() {
  return (
    <>
      <main>
        <Act1Gathering />
        <WelcomeLine />
        <VideoSwell />
        <ArrivalCard />
        <Act5Exhale />
        <InvitationScreen />
      </main>
      <TurndownFooter />
    </>
  );
}
