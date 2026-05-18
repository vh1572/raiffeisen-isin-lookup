import { clearApiTokenCache, getApiToken } from "./token.js";

const API_BASE = "https://structuredproducts.raiffeisen.ch/website-api";

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

export async function fetchProductByIsin(isin, options = {}) {
  return requestProduct(isin, options);
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
