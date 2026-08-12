import type { Metadata } from "next";
import { PaymentScreen } from "@/features/booking/components/payment-screen/payment-screen";

export const metadata: Metadata = {
  title: "Payment — Mariva",
  description:
    "Pay for your stay with VNPay. The property never sees your card details.",
};

// A step of its own rather than a section of `details`, which is what keeps
// payment-step abandonment measurable — `FR-BOOK-06`. A guest who leaves here
// left at a url, and a guest who left at the room list left at a different one.
export default async function HoldPaymentPage({
  params,
}: {
  readonly params: Promise<{ readonly hold: string }>;
}) {
  const { hold } = await params;

  return <PaymentScreen hold={hold} />;
}
