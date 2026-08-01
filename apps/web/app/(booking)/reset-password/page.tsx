// /reset-password — where the API redirects a guest who followed a reset link.
//
// It arrives carrying `?token=…` on success, or `?error=…` when the token has
// expired or already been spent. Both are read here rather than in the client
// screen; see verify-email/page.tsx for why.

import type { Metadata } from "next";
import { ResetPasswordScreen } from "@/features/auth/components/reset-password-screen";

export const metadata: Metadata = {
  title: "Choose a new password — Mariva",
  description: "Set a new password for your Mariva account.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly token?: string;
    readonly error?: string;
  }>;
}) {
  const { token, error } = await searchParams;

  return (
    <ResetPasswordScreen token={token ?? null} linkError={error ?? null} />
  );
}
