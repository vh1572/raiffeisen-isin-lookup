/** Values stored as decimal fractions of nominal (e.g. 0.06 = 6%). */
export function formatFractionPercent(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

/** API bid may be 0–1 or 0–100. */
export function formatBidPercent(value) {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = value > 1 ? value : value * 100;
  return `${pct.toFixed(2)}%`;
}

export function fractionPercentSortValue(value) {
  if (value == null || Number.isNaN(value)) return null;
  return value * 100;
}

export function bidPercentSortValue(value) {
  if (value == null || Number.isNaN(value)) return null;
  return value > 1 ? value : value * 100;
}
