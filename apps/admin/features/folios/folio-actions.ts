import type { ServiceCatalogItem, StaffRole } from "@mariva/shared";
import { parseAmount } from "@/lib/desk-payment";

export function mayPostFolio(role: StaffRole): boolean {
  return role !== "HOUSEKEEPING";
}
export function mayReverseFolio(role: StaffRole): boolean {
  return role === "ACCOUNTANT" || role === "MANAGER" || role === "ADMIN";
}

export function chargeAttempt(
  bookingId: string,
  amount: string,
  description: string,
) {
  const grossAmount = parseAmount(amount);
  if (grossAmount === null || grossAmount <= 0n)
    return { problem: "Enter a positive whole-VND amount." } as const;
  if (description.trim() === "")
    return { problem: "Describe what the charge is for." } as const;
  return {
    input: {
      bookingId,
      grossAmount: grossAmount.toString(),
      description: description.trim(),
    },
  } as const;
}

export function serviceAttempt(
  bookingId: string,
  item: ServiceCatalogItem | null,
  quantityText: string,
  amountText: string,
) {
  if (item === null) return { problem: "Choose a service item." } as const;
  const quantity = Number(quantityText);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
    return {
      problem: "Quantity must be a whole number from 1 to 999.",
    } as const;
  if (item.unitPriceGross !== null)
    return { input: { bookingId, code: item.code, quantity } } as const;
  const grossAmount = parseAmount(amountText);
  if (grossAmount === null || grossAmount <= 0n)
    return {
      problem: "Enter the positive total agreed for this unpriced item.",
    } as const;
  return {
    input: {
      bookingId,
      code: item.code,
      quantity,
      grossAmount: grossAmount.toString(),
    },
  } as const;
}
