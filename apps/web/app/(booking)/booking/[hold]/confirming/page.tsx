import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmingScreen } from "@/features/booking/components/confirming-screen/confirming-screen";

export const metadata: Metadata = {
  title: "Confirming your payment — Mariva",
  description:
    "VNPay has sent you back. The property is confirming the payment before your booking is issued.",
};

// Where VNPay puts the payer down — the address `payment.controller.ts` builds
// from the reference it signed, and the step `repository-structure.md`
// §`(booking)` insists is not optional: the redirect and the IPN are
// independent, so the landing that receives one cannot be the confirmation.
//
// The screen reads `?payment=…` and therefore needs a Suspense boundary above
// it, the same as `/booking` does: Next renders the shell before it knows the
// query. A `null` fallback rather than a spinner, because the screen's own first
// paint is already "one moment" and a placeholder would be a second thing that
// flashes past on the way to it.
export default async function HoldConfirmingPage({
  params,
}: {
  readonly params: Promise<{ readonly hold: string }>;
}) {
  const { hold } = await params;

  return (
    <Suspense fallback={null}>
      <ConfirmingScreen hold={hold} />
    </Suspense>
  );
}
