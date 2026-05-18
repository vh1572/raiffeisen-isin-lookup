import { clearApiTokenCache, getApiToken } from "./token.js";
import { extractBarrierHit, extractProductRow } from "./extract.js";

const API_BASE = "https://structuredproducts.raiffeisen.ch/website-api";

const DEFAULT_OPTIONS = {
  partner: "RAIFFEISEN",
  region: "CH",
  language: "EN",
};

export function productBidPercent(product) {
  const bid = product.productFeed?.bid;
  if (bid == null || Number.isNaN(bid)) return null;
  return bid > 1 ? bid : bid * 100;
}

export function productMaturityDate(product) {
  const cal = product.calendar ?? {};
  return cal.redemptionDate ?? cal.lastTradingDate ?? null;
}

export function daysUntilMaturity(dateStr, now = Date.now()) {
  const t = Date.parse(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(t)) return null;
  return (t - now) / 86400000;
}

function matchesFilters(product, filters) {
  const maturity = productMaturityDate(product);
  if (!maturity) return false;

  const days = daysUntilMaturity(maturity, filters.now);
  if (days == null || days < 0 || days > filters.maturityDays) return false;

  const keyData = product.keyData ?? {};
  if (extractBarrierHit(product, keyData)) return false;

  const bid = productBidPercent(product);
  if (bid == null || bid < filters.bidMin || bid > filters.bidMax) return false;

  return true;
}

async function searchPage(pageNumber, options, retry = true) {
  const { partner, region, language } = { ...DEFAULT_OPTIONS, ...options };
  const token = options.apiToken ?? (await getApiToken());

  const body = {
    partner,
    regions: [region],
    language,
    productGroups: ["PG_BARRIER_REVERSE_CONVERTIBLE"],
    maturityRangeKey: ["0-LessThanSixMonths"],
    pageNumber,
    resultsPerPage: options.pageSize ?? 100,
    sortBy: "MATURITY_DATE",
    sortOrder: "ASC",
  };

  const response = await fetch(`${API_BASE}/brochure/search`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "raiffeisen-isin-lookup/1.0",
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401 && retry) {
    clearApiTokenCache();
    return searchPage(pageNumber, options, false);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `BRC search API ${response.status}${bodyText ? `: ${bodyText.slice(0, 120)}` : ""}`,
    );
  }

  return response.json();
}

/**
 * Scan barrier reverse convertibles: maturity within N days, no barrier hit, bid in range.
 */
export async function scanBrcProducts(options = {}) {
  const language = (options.language ?? DEFAULT_OPTIONS.language).toLowerCase();
  const filters = {
    maturityDays: options.maturityDays ?? 31,
    bidMin: options.bidMin ?? 80,
    bidMax: options.bidMax ?? 90,
    now: options.now ?? Date.now(),
  };

  const products = [];
  let pageNumber = 0;
  let totalHits = 0;
  let scanned = 0;
  let pagesFetched = 0;

  while (true) {
    const data = await searchPage(pageNumber, options);
    const brochures = data.brochures ?? [];
    totalHits = data.searchMetadata?.totalHits ?? totalHits;
    pagesFetched += 1;

    if (brochures.length === 0) break;

    for (const brochure of brochures) {
      const product = brochure.product;
      if (!product) continue;

      scanned += 1;
      if (!matchesFilters(product, filters)) continue;

      const isin = product.identifiers?.isin;
      if (!isin) continue;

      products.push(
        extractProductRow(isin, { brochures: [{ product }] }, language),
      );
    }

    if (brochures.length < (options.pageSize ?? 100)) break;
    if (totalHits > 0 && (pageNumber + 1) * (options.pageSize ?? 100) >= totalHits) {
      break;
    }

    pageNumber += 1;
  }

  return {
    filters: {
      productGroup: "PG_BARRIER_REVERSE_CONVERTIBLE",
      maturityDays: filters.maturityDays,
      bidMin: filters.bidMin,
      bidMax: filters.bidMax,
      noBarrierHit: true,
    },
    totalHits,
    scanned,
    pagesFetched,
    count: products.length,
    products,
  };
}
