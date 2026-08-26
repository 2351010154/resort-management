// How the rate a PayPal attempt froze is written on the screen that quotes it.
//
// Beside the component rather than inside it, and beside it rather than in
// `money.ts`, for the reason the block below gives: this is not a posting and
// has no business going through `Money` or `formatVnd`. It is out here at all
// so that the one thing which can go wrong with it — printing a rate that does
// not produce the dollar figure standing beside it — is provable without
// rendering a funnel, which is the arrangement `cancellation-price.ts` uses
// beside its own screen.

/**
 * "26.150,5 ₫" — the rate a foreign attempt was frozen at, as it was frozen.
 *
 * `money.ts` will not export a formatter for this, and rightly not: `Presentment.rate`
 * is đồng per whole dollar rather than a posting, so it is the one figure in
 * this file that is not a `VndAmount` and has no business going through
 * `Money` or `formatVnd`. `Number(rate)` is nonetheless safe here for the
 * reason `formatPresentment` gives on its own use of it — the value is about
 * to become a string and nothing reads it back — and this reads it purely to
 * print it, never to convert with it: the conversion already happened, once,
 * in `payment.service.ts`.
 */
export function formatRate(rate: string): string {
  // Printed at the precision it was stored at, and never rounded to whole
  // đồng. `fx_rate` is a bare `numeric` and the schema accepts any positive
  // decimal, so a property may well be on 26,150.5 — rounded to "26.151 ₫" it
  // sits beside an exact dollar figure it does not produce, and a guest who
  // multiplies the two finds the property's own screen disagreeing with
  // itself. The trailing zeros go because 26,150.50 and 26,150.5 are the same
  // rate and only one of them reads like a price.
  const decimals = Math.min(
    rate.split(".")[1]?.replace(/0+$/, "").length ?? 0,
    20,
  );

  const formatted = new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(rate));

  return `${formatted} ₫`;
}
