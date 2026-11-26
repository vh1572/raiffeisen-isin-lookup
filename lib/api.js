import { clearApiTokenCache, getApiToken } from "./token.js";

const SITE_BASE = "https://structuredproducts.raiffeisen.ch";
const API_BASE = `${SITE_BASE}/website-api`;
const PRODUCT_LANGUAGES = new Set(["DE", "EN", "FR", "IT"]);

const DEFAULT_OPTIONS = {
  partner: "RAIFFEISEN",
  region: "CH",
  language: "EN",
};

async function requestProduct(isin, options, retry = true) {
  const { partner, region, language } = { ...DEFAULT_OPTIONS, ...options };
  const params = new URLSearchParams({ partner, region, language });
  const url = `${API_BASE}/brochure/isin/${encodeURIComponent(isin)}?${params}`;
  const token = options.apiToken ?? (await getApiToken());

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "raiffeisen-isin-lookup/1.0",
    },
  });

  if (response.status === 401 && retry) {
    clearApiTokenCache();
    return requestProduct(isin, options, false);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `API ${response.status} for ${isin}${body ? `: ${body.slice(0, 120)}` : ""}`,
    );
  }

  return response.json();
}

async function requestPublicProduct(isin, language) {
  const url = `${SITE_BASE}/${language.toLowerCase()}/isin/${encodeURIComponent(isin)}`;
  const response = await fetch(url, {
    headers: { Accept: "text/html", "User-Agent": "raiffeisen-isin-lookup/1.0" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Raiffeisen product page returned HTTP ${response.status} for ${isin}`);
  }

  const html = await response.text();
  const match = html.match(/<script\b[^>]*>\s*window\.brochureJson\s*=\s*([\s\S]*?)\s*;?\s*<\/script\s*>/i);
  if (!match) {
    throw new Error(`No brochure data on the Raiffeisen product page for ${isin}`);
  }

  let brochure;
  try {
    brochure = JSON.parse(match[1]);
  } catch {
    throw new Error(`Invalid brochure data on the Raiffeisen product page for ${isin}`);
  }
  if (brochure?.product?.identifiers?.isin?.toUpperCase() !== isin.toUpperCase()) {
    throw new Error(`Raiffeisen product page did not return a matching brochure for ${isin}`);
  }

  return { brochures: [brochure] };
}

export async function fetchProductByIsin(isin, options = {}) {
  const { partner, region, language } = { ...DEFAULT_OPTIONS, ...options };
  if (
    options.apiToken != null ||
    process.env.RAIFFEISEN_API_TOKEN ||
    partner !== DEFAULT_OPTIONS.partner ||
    region !== DEFAULT_OPTIONS.region ||
    !PRODUCT_LANGUAGES.has(language.toUpperCase())
  ) {
    return requestProduct(isin, options);
  }
  return requestPublicProduct(isin, language);
}

export async function lookupIsins(isins, options = {}) {
  const concurrency = options.concurrency ?? 4;
  const results = new Array(isins.length);

  let index = 0;
  async function worker() {
    while (index < isins.length) {
      const i = index++;
      const isin = isins[i];
      try {
        const data = await fetchProductByIsin(isin, options);
        results[i] = { isin, ok: true, data };
      } catch (error) {
        results[i] = {
          isin,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, isins.length) }, () => worker()),
  );

  return results;
}
