// Money is always integer cents + currency (USD). Display helpers here so the
// server owns formatting (the client just renders value_display).

export function centsToDisplay(cents: number, opts: { withCents?: boolean } = {}): string {
  const dollars = cents / 100;
  const fractionDigits = opts.withCents ? 2 : 0;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const dollarsToCents = (d: number): number => Math.round(d * 100);
