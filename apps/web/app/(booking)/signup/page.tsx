// /signup — the other half of the door. `/login` links here by this name.

import type { Metadata } from "next";
import { SignUpScreen } from "@/features/auth/components/sign-up-screen";

export const metadata: Metadata = {
  title: "Create an account — Mariva",
  description: "Create a Mariva account to book and manage your stay.",
};

export default function SignUpPage() {
  return <SignUpScreen />;
}
