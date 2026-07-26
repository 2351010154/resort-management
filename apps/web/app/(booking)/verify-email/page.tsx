// /verify-email — where sign-up sends the guest, and where the API sends them
// back after they follow the link.
//
// The query is read here, on the server, rather than with `useSearchParams` in
// the screen. Next 16 makes that hook a suspense boundary the page would have
// to provide, and the screen would gain a loading state for a value that is
// known before the page is rendered at all.

import type { Metadata } from "next";
import { VerifyEmailScreen } from "@/features/auth/components/verify-email-screen";

export const metadata: Metadata = {
  title: "Confirm your email — Mariva",
  description: "Confirm your email address to finish setting up your account.",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly email?: string;
    readonly confirmed?: string;
  }>;
}) {
  const { email, confirmed } = await searchParams;

  return (
    <VerifyEmailScreen email={email ?? null} confirmed={confirmed === "1"} />
  );
}
