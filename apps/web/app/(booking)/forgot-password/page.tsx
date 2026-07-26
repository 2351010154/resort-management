// /forgot-password — the route `/login` links to from under the password field.

import type { Metadata } from "next";
import { ForgotPasswordScreen } from "@/features/auth/components/forgot-password-screen";

export const metadata: Metadata = {
  title: "Reset your password — Mariva",
  description: "Send yourself a link to choose a new password.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
