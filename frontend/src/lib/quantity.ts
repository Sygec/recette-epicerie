// Rounds to 2 decimals and drops trailing zeros (1.50 -> 1.5, 2.00 -> 2),
// matching how an unscaled quantity already renders via plain interpolation.
export function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}
