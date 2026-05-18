function localized(value, language = "en") {
  if (!value) return null;
  if (typeof value === "string") return value;
  const key = language.toLowerCase();
  return value[key] ?? value.en ?? value.de ?? value.fr ?? value.it ?? null;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return null;
  const pct = value > 1 ? value : value * 100;
  return `${pct.toFixed(2)}%`;
}

function tenorYears(product) {
  const cal = product.calendar ?? {};
  const issue = cal.issueDate;
  const end = cal.redemptionDate ?? cal.lastTradingDate;
  if (!issue || !end) return null;
  const d1 = Date.parse(`${issue}T12:00:00Z`);
  const d2 = Date.parse(`${end}T12:00:00Z`);
  if (Number.isNaN(d1) || Number.isNaN(d2) || d2 <= d1) return null;
  return (d2 - d1) / (365.25 * 24 * 3600 * 1000);
}

/** Sum scheduled coupon nominal cash (full term, not only paid). */
function sumScheduledCouponCash(features) {
  let sum = 0;

  const gccCoupons = features.guaranteedFixedRateCoupon?.coupons ?? [];
  for (const c of gccCoupons) {
    if (c.amount != null) sum += c.amount;
  }

  const ccfCoupons = features.conditionalCouponFeature?.coupons ?? [];
  for (const c of ccfCoupons) {
    if (c.amount != null) sum += c.amount;
  }

  return sum;
}

/** Number of coupon periods already paid (by payment date or paidAmount flag). */
function countPaidCoupons(features, todayISO) {
  let count = 0;

  for (const coupon of features.guaranteedFixedRateCoupon?.coupons ?? []) {
    if (coupon.paymentDate && coupon.paymentDate <= todayISO) {
      count += 1;
    }
  }

  for (const coupon of features.conditionalCouponFeature?.coupons ?? []) {
    if (coupon.paidAmount == null) continue;
    if (coupon.paymentDate && coupon.paymentDate > todayISO) continue;
    count += 1;
  }

  return count;
}

/** Payments per year from API frequency hint; used only when annual rate is missing in payload. */
function paymentsPerYear(couponFrequency) {
  if (!couponFrequency || typeof couponFrequency !== "string") return null;
  const f = couponFrequency.toUpperCase();
  if (f.includes("MONTH")) return 12;
  if (f.includes("QUART")) return 4;
  if (f.includes("SEMI")) return 2;
  if (f.includes("ANN") || f === "YEARLY") return 1;
  return null;
}

/** Normalize headline rate fields to decimals (e.g. 0.063 for 6.3%). */
function normalizeAnnualDecimal(rate) {
  if (rate == null || Number.isNaN(rate)) return null;
  return rate > 1 ? rate / 100 : rate;
}

/**
 * Annual coupon (decimal): prefer cashflow-schedule-implied annual so that,
 * grosso modo, (sum scheduled coupons / nominal) ≈ rate × tenor (years).
 * Falls back to API headline fields when no schedule totals are available.
 */
function extractCouponPa(product) {
  const features = product.features ?? {};
  const dynamic = product.dynamic ?? {};
  const gcc = features.guaranteedFixedRateCoupon;
  const ccf = features.conditionalCouponFeature;
  const denomination = product.investment?.denomination;
  const T = tenorYears(product);
  const scheduleCash = sumScheduledCouponCash(features);

  if (
    denomination != null &&
    denomination > 0 &&
    T != null &&
    T > 0 &&
    scheduleCash > 0
  ) {
    return (scheduleCash / denomination) / T;
  }

  // Headline fallbacks (annualize periodic couponRate when frequency is known)
  if (gcc?.couponRate != null) return normalizeAnnualDecimal(gcc.couponRate);

  if (ccf?.annualizedCouponRate != null) {
    return normalizeAnnualDecimal(ccf.annualizedCouponRate);
  }

  const ppy =
    paymentsPerYear(ccf?.couponFrequency) ??
    paymentsPerYear(gcc?.couponFrequency);

  if (ccf?.couponRate != null && ppy != null) {
    return normalizeAnnualDecimal(ccf.couponRate) * ppy;
  }

  if (ccf?.couponRate != null) {
    return normalizeAnnualDecimal(ccf.couponRate);
  }

  if (features.maximumCouponRate != null) {
    return normalizeAnnualDecimal(features.maximumCouponRate);
  }
  if (features.minimumCouponRate != null) {
    return normalizeAnnualDecimal(features.minimumCouponRate);
  }
  if (dynamic.maxYieldPa != null) {
    return normalizeAnnualDecimal(dynamic.maxYieldPa);
  }

  return null;
}

/**
 * Paid coupons as % of nominal: (Coupon P.A. / 12) × number of paid coupon periods.
 * couponPa is annual rate as decimal (e.g. 0.06 for 6% p.a.).
 */
function extractPaidCoupons(product, couponPa) {
  if (couponPa == null || Number.isNaN(couponPa)) return null;

  const features = product.features ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const paidCount = countPaidCoupons(features, today);

  if (paidCount <= 0) return null;

  return (couponPa / 12) * paidCount;
}

/** Bid (% of nominal) plus paid coupons (% of nominal), both as fraction of nominal. */
function extractBidPlusPaidCoupons(bid, paidCoupons) {
  if (bid == null || paidCoupons == null) return null;
  const bidFrac = bid > 1 ? bid / 100 : bid;
  return bidFrac + paidCoupons;
}

function extractBarrier(product, keyData) {
  if (keyData?.barrierLevelPercentage != null) {
    return formatPercent(keyData.barrierLevelPercentage);
  }

  const underlyingLevels = [
    ...new Set(
      (product.baskets ?? [])
        .flatMap((basket) => basket.underlyings ?? [])
        .map((u) => u.barrier?.barrierLevelPercentage)
        .filter((v) => v != null)
        .map((v) => formatPercent(v)),
    ),
  ];

  if (underlyingLevels.length > 0) {
    return underlyingLevels.join(" / ");
  }

  if (keyData?.barrierLevelAbs != null) {
    return formatNumber(keyData.barrierLevelAbs);
  }

  return null;
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return null;
  return Number(value).toFixed(digits);
}

function recentUnderlyingPrice(underlyingFeed) {
  if (!underlyingFeed) return null;
  return (
    underlyingFeed.spot ??
    underlyingFeed.bid ??
    underlyingFeed.ask ??
    null
  );
}

function shortenUnderlyingName(u, language = "en", maxLen = 14) {
  const raw =
    u.shortName ?? u.name ?? localized(u.titleI18N, language) ?? null;
  if (!raw) return null;
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen - 1)}…`;
}

function underlyingStrike(u) {
  return u.dynamic?.strikeLevelAbs ?? u.initialFixingLevelAbs ?? null;
}

function underlyingPerformanceRatio(u) {
  const strike = underlyingStrike(u);
  const spot = recentUnderlyingPrice(u.underlyingFeed);
  if (strike == null || strike <= 0 || spot == null) return null;
  return spot / strike;
}

/**
 * Projected redemption as fraction of nominal if spots stay at current levels.
 * - Barrier product, barrier hit: worst-of (spot/strike).
 * - Barrier product, not hit: 100% nominal.
 * - Other reverse structures: min(100%, worst-of spot/strike).
 */
function extractMaturityValuePct(product, keyData) {
  const underlyings = (product.baskets ?? []).flatMap(
    (basket) => basket.underlyings ?? [],
  );
  if (underlyings.length === 0) return null;

  const ratios = underlyings
    .map((u) => underlyingPerformanceRatio(u))
    .filter((r) => r != null);
  if (ratios.length === 0) return null;

  const worstRatio = Math.min(...ratios);
  const barrierHit = extractBarrierHit(product, keyData);
  const hasBarrier =
    keyData?.barrierLevelPercentage != null ||
    keyData?.barrierLevelAbs != null ||
    underlyings.some((u) => u.barrier != null);

  if (hasBarrier && !barrierHit) {
    return 1;
  }

  if (barrierHit) {
    return worstRatio;
  }

  return Math.min(1, worstRatio);
}

function extractUnderlyingDetails(product, language = "en") {
  return (product.baskets ?? [])
    .flatMap((basket) => basket.underlyings ?? [])
    .map((u) => {
      const name = shortenUnderlyingName(u, language);
      if (!name) return null;

      const initialFixing = u.initialFixingLevelAbs ?? null;
      const recentPrice = recentUnderlyingPrice(u.underlyingFeed);
      let priceChangePct = null;
      if (initialFixing != null && initialFixing > 0 && recentPrice != null) {
        priceChangePct = (recentPrice - initialFixing) / initialFixing;
      }

      return {
        name,
        initialFixing,
        recentPrice,
        priceChangePct,
        performanceRatio: underlyingPerformanceRatio(u),
        currency: u.currency ?? null,
      };
    })
    .filter(Boolean);
}

function extractUnderlyings(product, language = "en") {
  const details = extractUnderlyingDetails(product, language);
  return details.length > 0 ? details.map((u) => u.name).join(", ") : null;
}

export function extractBarrierHit(product, keyData) {
  if (keyData?.productBarrierEvent === true) return true;
  if ((keyData?.barrierHitCount ?? 0) > 0) return true;

  return (product.baskets ?? []).some((basket) =>
    (basket.underlyings ?? []).some((u) => u.barrier?.barrierHit === true),
  );
}

export function extractProductRow(isin, apiResponse, language = "en") {
  const brochure = apiResponse?.brochures?.[0];
  const product = brochure?.product;

  if (!product) {
    const apiError =
      apiResponse?.errors?.messages?.[0]?.message ??
      apiResponse?.errors?.message ??
      "No product found for this ISIN";
    return { isin, error: apiError };
  }

  const identification = product.identification ?? {};
  const identifiers = product.identifiers ?? {};
  const calendar = product.calendar ?? {};
  const investment = product.investment ?? {};
  const feed = product.productFeed ?? {};
  const payoff = product.payoff ?? {};
  const keyData = product.keyData ?? {};

  const couponPa = extractCouponPa(product);
  const paidCoupons = extractPaidCoupons(product, couponPa);

  return {
    isin: identifiers.isin ?? isin,
    valoren: identifiers.valoren ?? null,
    underlyings: extractUnderlyings(product, language),
    underlyingDetails: extractUnderlyingDetails(product, language),
    couponPa,
    productGroup:
      localized(identification.productGroupI18N, language) ??
      identification.productGroup ??
      null,
    status: identification.status ?? null,
    currency: investment.investmentCurrency ?? null,
    denomination: investment.denomination ?? null,
    bid: feed.bid ?? null,
    feedDate: feed.date ?? null,
    paidCoupons,
    bidPlusPaidCoupons: extractBidPlusPaidCoupons(feed.bid ?? null, paidCoupons),
    maturityValuePct: extractMaturityValuePct(product, keyData),
    barrierLevel: extractBarrier(product, keyData),
    barrierHit: extractBarrierHit(product, keyData),
    maturity: calendar.redemptionDate ?? calendar.lastTradingDate ?? null,
    issueDate: calendar.issueDate ?? null,
    expired: product.expired ?? false,
    participation:
      payoff.participation != null
        ? formatPercent(payoff.participation)
        : null,
    productUrl: `https://structuredproducts.raiffeisen.ch/en/isin/${identifiers.isin ?? isin}`,
  };
}

export function summarizeLookupResults(results, language = "en") {
  return results.map((entry) => {
    if (!entry.ok) {
      return { isin: entry.isin, error: entry.error };
    }
    return extractProductRow(entry.isin, entry.data, language);
  });
}
