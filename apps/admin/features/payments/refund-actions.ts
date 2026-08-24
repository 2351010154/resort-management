import type { StaffRole } from "@mariva/shared";
import { parseAmount } from "@/lib/desk-payment";

export function mayPolicyRefund(role: StaffRole): boolean {
  return role !== "HOUSEKEEPING";
}
export function mayOverrideRefund(role: StaffRole): boolean {
  return role === "MANAGER" || role === "ADMIN";
}
export function overrideRefundAttempt(
  bookingId: string,
  amountText: string,
  reason: string,
) {
  const amount = parseAmount(amountText);
  if (amount === null || amount <= 0n)
    return { problem: "Enter a positive whole-VND refund amount." } as const;
  if (reason.trim() === "")
    return { problem: "Give the reason for overriding policy." } as const;
  return {
    input: { bookingId, amount: amount.toString(), reason: reason.trim() },
  } as const;
}
