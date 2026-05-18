const TOKEN_PAGE = "https://structuredproducts.raiffeisen.ch/en/isin/CH1421075693";
const TOKEN_PATTERN =
  /window\.token\s*=\s*window\.token\s*\|\|\s*['"]([^'"]+)['"]/;

let cachedToken = null;
let cachedAt = 0;
const CACHE_MS = 30 * 60 * 1000;

function decodeJwtExpiry(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    if (payload.exp) {
      return payload.exp * 1000;
    }
  } catch {
    // ignore decode errors
  }
  return cachedAt + CACHE_MS;
}

export async function getApiToken() {
  if (process.env.RAIFFEISEN_API_TOKEN) {
    return process.env.RAIFFEISEN_API_TOKEN;
  }

  const now = Date.now();
  if (cachedToken && now < cachedAt) {
    return cachedToken;
  }

  const response = await fetch(TOKEN_PAGE, {
    headers: { "User-Agent": "raiffeisen-isin-lookup/1.0" },
  });

  if (!response.ok) {
    throw new Error(`Failed to load API token page (${response.status})`);
  }

  const html = await response.text();
  const match = html.match(TOKEN_PATTERN);
  if (!match?.[1]) {
    throw new Error("Could not extract API token from Raiffeisen website");
  }

  cachedToken = match[1];
  cachedAt = decodeJwtExpiry(cachedToken) - 60_000;
  return cachedToken;
}

export function clearApiTokenCache() {
  cachedToken = null;
  cachedAt = 0;
}
